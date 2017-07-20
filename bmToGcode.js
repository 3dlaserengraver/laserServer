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
	G91.1 - sets it to relative distance mode. Arc moves I,J must be specified (x,y offsets from current position of axis)
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
var BMX_TO_DEGREES = 360/4096; //Conversion ratio between stepper steps per rotation to degrees
var Z_STEPS_TO_MM = 0.01; //*** Need to calculate this value
var XY_STEPS_TO_MM = 0.01; //*** Need to calculate this value
var MAX_Z = 300.0; //*** Need to calculate this value
var SPI_STR_LENGTH = 50; //*** don't know what the grbl fimware limit is
var LASER_FOCUS_DISTANCE = 100; //100 mm *** testing needed to find correct value 
var ABS_X_CENTER_COOR = 500; //*** Still need to find out this value
var ABS_Y_CENTER_COOR = 500; //*** Still need to find out this value
var TRUE = 1;
var FALSE = 0;

//Variables
var txbuf = new Buffer.alloc(50); //Buffer's used to send and receive with SPI
var rxbuf = new Buffer.alloc(50);

//***test Degrees:	0	45	90	135	180	225	270	315
// inverse			180	225	270	315	0	45	90	135	
//				    0  	1  	2  	3  	4  	5  	6  	7
var testBitmap = [ [0, 	0, 	2, 	3, 	4,  0,  0, 	0], //0
				   [0, 	0, 	0, 	0, 	0,  0, 	2, 	2], //1
				   [2, 	2, 	0, 	0, 	0, 	0, 	0, 	0], //2
				   [0, 	0, 	0, 	0, 	0, 	0, 	0, 	0], //3
				   [4, 	4, 	0, 	0, 	0, 	0, 	5,  5],	//4
				   [6, 	6, 	0, 	0, 	0, 	0, 	0,  0]	//5
				 ];

///////////////////////
//Cases that need to be handled:
//1) new row,same value 0 //don't need to do anything
//2) new row, same value >0 //go to beginning of row with G0 
//3) new row, different value 0 -> >0 //Use G0 go go straight to differential point 
//4) new row, different value >0 -> 0 
//5) new row, different value >0 -> >0
//6) same row, 0 -> >0 
//7) same row, >0 -> 0
//8) same row, >0 -> >0
///////////////////////

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
		SPIsendString(txString); //*** needs to be changed to UART comms
		//if(rxbuf)...//TODO Check for errors from stm32f0, send rx messages to webapp?
	}
	else{ //Cylinder
		
		txString = "S0\n$H\nG17\nG91.1\nM4"; //***Needs to be tested
		SPIsendString(txString); //*** needs to be changed to UART comms
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
			bitMap - 2D array of chars (value 0-255) of size *** (hasn't been defined yet)
			height - float that indicates the height of the object that is being engraved in mm
			diameter - float - only should receive this parammeter when a cylindrical object is being engraved. in mm
*/

function bitmapToGcode(bitMap, height, diameter){
	
	var x=0,y=0,z=0,power=0,i=0,j=0;
	var previousValue = 0,previousRow=0;
	var laserOn = 0; //Variable to track what state the laser is in
	var txString = "$X"; //*** in final code we should remove this (it cancels the homing)

	var ROW_WIDTH = bitMap[0].length;

	SPIsendString(txString);
	txString = "F5"; //Need F* when sending S commands, 5 is arbirary as long as it's >0
	SPIsendString(txString);


	//This double for loop will send commands to the stm32f0 whenever it reaches a change of state.
	if(typeof(diameter) === 'undefined'){ //Plane

		z = height + LASER_FOCUS_DISTANCE; //For plane the z is a constant height
		txString = "G0Z"+z; 
		SPIsendString(txString);

		//TODO improve first iteration where it will move in slow mode (G1) whether the laser is on or off.
		console.log("Planar Mode:")

		for(var bmY=0; bmY<bitMap.length; bmY++){
			for(var bmX=0; bmX<bitMap[0].length; bmX++){
				
				//Check for a change in power level
				if(bitMap[bmY][bmX] !== previousValue){ 

					//Decide whether to use G0 or G1 and sets the x value
					if(bmY !== previousRow){ 
						if(previousValue === 0){
							x = bmX * XY_STEPS_TO_MM;
						}
						else{
							bmX = 0;
							x = 0;
						}
						laserOn = FALSE;
					}

					else{
						x = bmX * XY_STEPS_TO_MM; 
						if(previousValue > 0){
							laserOn = TRUE;
						}
						else{
							laserOn = FALSE;
						}
					}
					
					power = laserOn*previousValue;

					//With the grbl xy coordinates the bottom left is 0,0 (x,y)
					//therefore I need to invert the rows here so that the engraved image is not inverted
					y = (bitMap.length - 1 - bmY) * XY_STEPS_TO_MM;

					txString = "G"+laserOn+"X"+x+"Y"+y+"S"+power;
					SPIsendString(txString); //*** needs to be changed to UART comms
				}
				//Checks if a row ends with power >0 fixing a bug that caused the code to not create a path
				//for the laser if the path ended on the end of a row
				else if(bmX === (ROW_WIDTH-1) && bitMap[bmY][bmX] > 0){
					x = (ROW_WIDTH-1) * XY_STEPS_TO_MM; 
					power = bitMap[bmY][(bmX)];
					laserOn = 1;

					//With the grbl xy coordinates the bottom left is 0,0 (x,y)
					//therefore I need to invert the rows here so that the engraved image is not inverted
					y = (bitMap.length - 1 - bmY) * XY_STEPS_TO_MM;

					txString = "G"+laserOn+"X"+x+"Y"+y+"S"+power;
					SPIsendString(txString); //*** needs to be changed to UART comms
				}
				//2) Checks if there has been change of rows and no change in power (>0)
				else if(bmX === 0 && previousValue > 0){
					x = 0;
					power = 0;
					laserOn = 0;

					//With the grbl xy coordinates the bottom left is 0,0 (x,y)
					//therefore I need to invert the rows here so that the engraved image is not inverted
					y = (bitMap.length - 1 - bmY) * XY_STEPS_TO_MM;

					txString = "G"+laserOn+"X"+x+"Y"+y+"S"+power;
					SPIsendString(txString); //*** needs to be changed to UART comms
				}
				

				//Save current values of next iteration
				previousRow = bmY;
				previousValue = bitMap[bmY][bmX];
			}
		}
	}
	
	//-----------------------------

	else{ //Cylinder
		var radius = diameter/2 + LASER_FOCUS_DISTANCE;
		x = radius;
		y = 0;
		a = 180;
		i = ABS_X_CENTER_COOR - x; //the starting center coordinates (relative to starting location)
		j = ABS_Y_CENTER_COOR - y; //the starting center coordinates (relative to starting location)
		
		console.log("Cylindrical mode:");
		//Move to starting point (straight to the right of the top of the object)
		txString = "G0X" + radius + "Y0Z" + height;
		SPIsendString(txString); //*** needs to be changed to UART comms
		txString = "Y" + ABS_Y_CENTER_COOR + "A180"
		SPIsendString(txString); //*** needs to be changed to UART comms
		
		for(var bmZ=bitMap.length - 1; bmZ>= 0; bmZ--){
			for(var bmX=0; bmX<bitMap[0].length; bmX++){
				//Check for a change in power level
				if(bitMap[bmZ][bmX] !== previousValue){ 
					if(bmZ !== previousRow && bitMap[bmZ][bmX] > 0 ){
						bmX = 0;
						x = radius * XY_STEPS_TO_MM;
						y = 0; 
						a = 180;
					}
					else{
						x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM; //*** what is the max deccimal points for grbl???
						y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM;//*** 
						a = (bmX*BMX_TO_DEGREES+180)%360;
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

					z = height - bmZ * Z_STEPS_TO_MM;
					
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
					//Send G-code with xyz value and the relative center of rotation 
					//power is turned on when laserOn is true.

 					txString = "G3X"+x+"Y"+y+"Z"+z+"A"+a+"I"+i+"J"+j+"S"+power;  
					SPIsendString(txString); //*** needs to be changed to UART comms
					
					//Calculate the relative center location for next move
					i = ABS_X_CENTER_COOR - x;
					j = ABS_Y_CENTER_COOR - y;

					previousRow = bmZ;

				}
				//Checks if a row ends with a power >0 fixing a bug that caused the code to not create a path
				//for the laser that went to the end
				else if(bmX === (ROW_WIDTH-1) && bitMap[bmZ][bmX] > 0){
					//*** To do it this way we need to have the software not include the last column of resolution
					//that the hardware is capable of doing. 
					x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM; 
					y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM;
					z = height - bmZ * Z_STEPS_TO_MM;
					a = (bmX*BMX_TO_DEGREES+180)%360; 
					power = bitMap[bmZ][(bmX)];
					txString = "G3X"+x+"Y"+y+"Z"+z+"A"+a+"I"+i+"J"+j+"S"+power;

					SPIsendString(txString); //*** needs to be changed to UART comms

					//Calculate the relative center location for next move
					i = ABS_X_CENTER_COOR - x;
					j = ABS_Y_CENTER_COOR - y;

				}
				//Checks if there has been change of rows and in power (>0)
				else if(bmX === 0 && previousValue > 0){
					x = (radius*Math.cos(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM; //*** what is the max deccimal points for grbl???
					y = (radius*Math.sin(bmX*BMX_TO_DEGREES*Math.PI/180)).toFixed(3) * XY_STEPS_TO_MM;//*** what is the max for grbl???
					z = height - bmZ * Z_STEPS_TO_MM;
					a = 180; 
					power = 0;
					txString = "G3 X"+x+"Y"+y+"Z"+z+"A"+a+"I"+i+"J"+j+"S"+power;

					SPIsendString(txString); //*** needs to be changed to UART comms

					//Calculate the relative center location for next move
					i = ABS_X_CENTER_COOR - x;
					j = ABS_Y_CENTER_COOR - y;
				}
				previousValue = bitMap[bmZ][bmX];
			}
		}
	}
}


function SPIsendString(txString){
	//txbuf.fill(0); //Clear Buffers
	//rxbuf.fill(0);	
	//rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
	console.log(txString);
	// TODO ***Error checking with rxbuf...
}

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