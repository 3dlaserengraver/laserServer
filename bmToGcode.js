/*
	Author: Caleb Schulz

	Note: All values are steps unless otherwise indicated.

	Bugs: Currently if there is a single value at the end of a row in the bitmap
	the function will not actually engrave that spot. This may be not a big problem
	since we have decent resolution.

*/
/*
	G-codes/GRBL Commands:
	$H - runs the homing routine
	G0 - Rapid linear motion
	G1 - Linear Motion
		Linear motion example: G0/G1 X1.2 Y2.1 Z3 E4
		XYZ in mm, E is gimbal stepper position in steps (*** need to set this in firmware)
	G2 - Clockwise arc
	G3 - Counter-clockwise arc
	G17 - sets it so arc moves (G2,G3) move on the XY plane
	G90.1 - sets it to absolute distance mode. Arc moves I,J must be specified (x,y offsets from 0 position of axis)
	S* - Sets the laser power level where * = 0-255 (0 is off) (***need to confirm this is the correct range for grbl) 
	M4 puts the engraver in dynamic laser power mode (auto turn laser on to S* power level when moving(G1-3))
*/

//var //rpio = require('//rpio');

//rpio.spiBegin();
//rpio.spiChipSelect(0);                  // Use CE0 
//rpio.spiSetCSPolarity(0, //rpio.LOW);    
//rpio.spiSetClockDivider(128);           //250 MHz /(parameter) = SPI Transmit frequency
/*
 *  Mode | CPOL | CPHA
 *  -----|------|-----
 *    0  |  0   |  0
 *    1  |  0   |  1
 *    2  |  1   |  0
 *    3  |  1   |  1
 */
//rpio.spiSetDataMode(0);  


//"Constants"
var BMX_TO_DEGREES = 360/8; //*** for testing//360/4096; //Conversion ratio between stepper steps per rotation to degrees
var Z_STEPS_TO_MM = 0.01; //*** Need to calculate this value
var XY_STEPS_TO_MM = 0.01; //*** Need to calculate this value
var MAX_Z = 300.0; //*** Need to calculate this value
var SPI_STR_LENGTH = 50; //Arbitrarily set
var ROW_WIDTH = 8; //*** need to find correct value for this *** possibly don't need them???
var COLUMN_HEIGHT = 1000;//*** need to find correct value for this
var LASER_FOCUS_DISTANCE = 100; //100 mm *** testing needed to find correct value 
var X_ZERO = 0; //Zero values are used for cylindrical mode for setting the axis of rotation
var Y_ZERO = 0; //***Once engraver is built these values need to be set
var TRUE = 1;
var FALSE = 0;

//Variables
var txbuf = new Buffer.alloc(50); //Buffer's used to send and receive with SPI
var rxbuf = new Buffer.alloc(50);

//***test Degrees:	0	45	90	135	180	225	270	315
// inverse			180	225	270	315	0	45	90	135
//				    0  	1  	2  	3  	4  	5  	6  	7
var testBitmap = [ [0, 	0, 	1, 	1, 	0,  0,  1, 	1], //0
				   [0, 	0, 	0, 	0, 	0,  0, 	0, 	0], //1
				   [2, 	2, 	0, 	0, 	0, 	0, 	3, 	3], //2
				   [3, 	3, 	0, 	0, 	0, 	0, 	4, 	4], //3
				   [5, 	5, 	0, 	0, 	0, 	0, 	0,  0]	//4
				 ];

//Function to send a string (gCode) directly to the STM32f0 (TODO console like feature on web app)
function gcodeConsole(gcode){
	SPIsendString(gcode); 
}

/* 	configEngraver

	Description: Based on if there is a diameter argument or not it will send a gCode 
	string the configures the engraver with the appropriate settings.

*/
function configEngraver(diameter){ 
	var txString = "";


	if(typeof(diameter === 'undefined')) { //Plane
		//*** Still need to figure out how to correctly set coordinate system
		txString = "S0\n$H\nG90.1\nM4"; //***Needs to be tested
		//SPIsendString(txString); *** needs to be changed to UART comms
		//if(rxbuf)...//TODO Check for errors from stm32f0, send rx messages to webapp?
	}
	else{ //Cylinder
		
		txString = "S0\n$H\nG17\nG90.1\nM4"; //***Needs to be tested
		//SPIsendString(txString); *** needs to be changed to UART comms
		//if(rxbuf)...//TODO Check for errors from stm32f0, send rx messages to webapp?

		//DEBUG
		//console.log(txString);
	}
}

/*	bitmapTocode

	Description:Receives a 2d array (bitmap) and parses through it creating gcode scripts that it sends over SPI
	to a STM32f0. What the parsing does is find any changes in value and tells the laser to go to the appropiate
	location while also deciding what power level to set the laser at for that move.

	Arguments: 
		bitMap - 2D array of chars (value 0-255) of size ***
		height - float that indicates the height of the object that is being engraved in mm
		diameter - float - only should receive this parammeter when a cylindrical object is being engraved. in mm
*/

function bitmapToGcode(bitMap, height, diameter){
	var txString ="";
	var x=0,y=0,z=0,power=0;
	var previousValue = 0,previousRow=0;
	var laserOn = 0; //Variable to track what state the laser is at
	
	//This double for loop will send commands to the stm32f0 whenever it reaches a change of state as it.
	console.log(typeof(diameter));
	if(typeof(diameter) === 'undefined'){ //Plane
		z = (height + LASER_FOCUS_DISTANCE); //* Z_STEPS_TO_MM; ***commented out for testing//For plane the z is a constant height
		//TODO improve first iteration where it will move in slow mode (G1) whether the laser is on or off.
		console.log("Planar Mode:")

		for(var bmY=0; bmY<bitMap.length; bmY++){
			for(var bmX=0; bmX<bitMap[0].length; bmX++){
				
				//Check for a change in power level
				if(bitMap[bmY][bmX] !== previousValue){ 
					
					// When moving to the next row start start at x=0
					if(bmY !== previousRow && bitMap[bmY][bmX] > 0 ){
						bmX = 0;
						x = 0; 
					}
					else{
						x = bmX; //*** * XY_STEPS_TO_MM; 
					}

					previousRow = bmY; 
					
					if(bitMap[bmY][bmX] > 0 && previousValue === 0){
						laserOn = FALSE;
					}
					else{
						laserOn = TRUE;
					}
					y = bmY;//**** * XY_STEPS_TO_MM;
					if(bmX === 0){
						power = 0;
					}
					else{
						power = laserOn*bitMap[bmY][(bmX-1)];
					}

					txString = "G"+laserOn+"X"+x+"Y"+y+"Z"+z+"S"+power; //*** remove spaces
							
					//SPIsendString(txString); 
					console.log(txString);
				}
				//Checks if a row ends with a power >0 fixing a bug that caused the code to not create a path
				//for the laser that went to the end
				else if(bmX === (ROW_WIDTH-1) && bitMap[bmY][bmX] > 0){
					//*** To do it this way we need to have the software not include the last column of resolution
					//that the haradware is capable of doing. 
					x = ROW_WIDTH-1;//*** * XY_STEPS_TO_MM; 
					y = bmY;//*** * XY_STEPS_TO_MM;
					power = bitMap[bmY][(bmX)];
					txString = "G"+1+"X"+x+"Y"+y+"Z"+z+"S"+power; 
					console.log(txString);
					//SPIsendString(txString); *** needs to be changed to UART comms
				}
				//Checks if there has been change of rows and now change in power (>0)
				else if(bmX === 0 && previousValue > 0){
					x = 0;
					y = bmY;//*** * XY_STEPS_TO_MM;
					power = 0;
					txString = "G"+0+" X"+x+" Y"+y+" Z"+z+" S"+power; //*** remove spaces
					console.log(txString);
					//SPIsendString(txString); *** needs to be changed to UART comms
				}
				previousValue = bitMap[bmY][bmX];
			}
		}
	}
	
	//-----------------------------

	else{ //Cylinder
		var radius = diameter/2 + LASER_FOCUS_DISTANCE;
		x = radius;
		y = 0;
		e = 180;
		//Move to starting point (straight to the right of the top of the object)
		txString = "G0X" + radius + "Y0Z" + height + "E0";
		//SPIsendString(txString);
		console.log("Cylindrical mode:");
		console.log(txString);
		
		for(var bmZ=0; bmZ<bitMap.length; bmZ++){
			for(var bmX=0; bmX<bitMap[0].length; bmX++){
				//Check for a change in power level
				if(bitMap[bmZ][bmX] !== previousValue){ 
					if(bmZ !== previousRow && bitMap[bmZ][bmX] > 0 ){
						bmX = 0;
						x = radius;//*** * XY_STEPS_TO_MM;
						y = 0; 
						e = 180;//***/BMX_TO_DEGREES;
					}
					else{
						x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM; //*** what is the max deccimal points for grbl???
						y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM;//*** what is the max for grbl???
						e = (bmX*BMX_TO_DEGREES+180)%360;//*** /BMX_TO_DEGREES; //*** need to confirm if this is the way to go in GRBL
					}

					//				   y+
					//				   |     * End Point
					//				   |    /^
					//				   |   / |
					//				   |  /  | radius*sin(bmX)    (bmX = angle)
					//				   | /   |
					//				   |/    |
		      		//		 ----------|----->-------*-- x+
					//				   |  ^		     Start point
					//				   |  |
					//				   |  radius*cos(bmX)

					
					
					z = height - bmZ;//*** * Z_STEPS_TO_MM;
					
					
					///////// Set Power

					//When a difference in power in the bitmap is found this algorithm tells the laser to go to that
					//location. So when there is a positive differential the laser needs to be off as it goes to that location
					if(bitMap[bmZ][bmX] > 0 && previousValue === 0){
						laserOn = FALSE;
					}
					else{
						laserOn = TRUE;
					}

					//Ensures that when moving to a next row the power is not on (to avoid undesired points being engraved)
					if(bmX === 0){
						power = 0;
					}
					else{
						power = laserOn*bitMap[bmZ][(bmX-1)];
					}
					//Send G-code with xyz value and the center of rotation 
					//power is turned on when laserOn is true.

					//*** currently assuming that we can set the origin at the center (I0J0)
 					txString = "G3 X"+x+" Y"+y+" Z"+z+" E"+e+" I0J0 S"+power; //*** remove spaces	 
					//SPIsendString(txString); *** needs to be changed to UART comms

					previousRow = bmZ;

					//DEBUG
					console.log(txString);
				}
				//Checks if a row ends with a power >0 fixing a bug that caused the code to not create a path
				//for the laser that went to the end
				else if(bmX === (ROW_WIDTH-1) && bitMap[bmZ][bmX] > 0){
					//*** To do it this way we need to have the software not include the last column of resolution
					//that the haradware is capable of doing. 
					x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM; 
					y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM;
					z = height - bmZ;//*** * Z_STEPS_TO_MM;
					e = (bmX*BMX_TO_DEGREES+180)%360;//*** /BMX_TO_DEGREES; //*** need to confirm if this is the way to go in GRBL
					power = bitMap[bmZ][(bmX)];
					txString = "G3 X"+x+" Y"+y+" Z"+z+" E"+e+" I0J0 S"+power; //*** remove spaces
					console.log(txString);
					//SPIsendString(txString); *** needs to be changed to UART comms
				}
				//Checks if there has been change of rows and in power (>0)
				else if(bmX === 0 && previousValue > 0){
					x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM; //*** what is the max deccimal points for grbl???
					y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3);//*** * XY_STEPS_TO_MM;//*** what is the max for grbl???
					z = height - bmZ;//*** * Z_STEPS_TO_MM;
					power = 0;
					txString = "G3 X"+x+" Y"+y+" Z"+z+" E"+e+" I0J0 S"+power; //*** remove spaces
					console.log(txString);
					//SPIsendString(txString); *** needs to be changed to UART comms
				}
				previousValue = bitMap[bmZ][bmX];
			}
		}
	}
	// Sample arc command:  G2 or G3 <X- Y- Z- I- J- P->
	//Does the firmware expect the <> brackets???
	//Z - helix
	//I - X offset
	//J - Y offset
	//P - number of turns
}



function SPIsendString(txString){
	txbuf.fill(0); //Clear Buffers
	rxbuf.fill(0);	
	rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
	//***Error checking with rxbuf...
}

//*** testing functions
bitmapToGcode(testBitmap,10);

//Add "Jogging function"
/*
Executing a jog requires a specific command structure, as described below:

The first three characters must be '$J=' to indicate the jog.

The jog command follows immediate after the '=' and works like a normal G1 command.

Feed rate is only interpreted in G94 units per minute. A prior G93 state is ignored during jog.

Required words:

XYZ: One or more axis words with target value.
F - Feed rate value. NOTE: Each jog requires this value and is not treated as modal.
Optional words: Jog executes based on current G20/G21 and G90/G91 g-code parser state. If one of the following optional words is passed, that state is overridden for one command only.

G20 or G21 - Inch and millimeter mode
G90 or G91 - Absolute and incremental distances
G53 - Move in machine coordinates

0x85 : Jog Cancel
*/