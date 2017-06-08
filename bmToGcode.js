var rpio = require('rpio');

rpio.spiBegin();
rpio.spiChipSelect(0);                  // Use CE0 
rpio.spiSetCSPolarity(0, rpio.LOW);    
rpio.spiSetClockDivider(128);           //250 MHz /16 = 15.625
/*
 *  Mode | CPOL | CPHA
 *  -----|------|-----
 *    0  |  0   |  0
 *    1  |  0   |  1
 *    2  |  1   |  0
 *    3  |  1   |  1
 */
rpio.spiSetDataMode(0);  


//"Constants"
var PLANE = 0x1;
var CYLINDER = 0x0;
var SPI_STR_LENGTH = 50;
var ROW_WIDTH = 1000; //*** need to find correct value for this
var COLUMN_HEIGHT = 1000;//*** need to find correct value for this
var LASER_FOCUS_DISTANCE = 100; //100 mm *** testing needed to find correct value 
var TRUE = 1;
var FALSE = 0;

var txbuf = new Buffer.alloc(50); //Buffer's used to send and receive with SPI
var rxbuf = new Buffer.alloc(50);
var laserOn = 0; //Variable to track what state the laser is at
var cylY = 0; //
function configureEngraver(cylOrPln){
	var txString = "";
	//Home 
  	//$H - runs the homing routine
	//G17 - sets it so arc moves (G2,G3) move on the XY plane
	//G90.1 - sets it to absolute distance mode. Arc moves I,J must be specified (x,y offsets from 0 position of axis)
	//*** do I need G21 - changes to mm length unit
	txbuf.fill(0); //Clear Buffers
	rxbuf.fill(0);
	txString = "$H\nG17\nG90.1"; //***Not certain I can send these 3 commands here
	rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
	txbuf.fill(0); //Clear Buffers
	rxbuf.fill(0);
	rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
	//if(rxbuf)...//***Check for errors from stm32f0
}

	set feedrate
/*
	
*/
function bitmapToGcode(cylOrPln, bitMap, objHghtOrDmtr){
	var txString ="";
	//This double for loop will send commands to the stm32f0 whenever it reaches a change of state as it.
	//***currently only goes from on to off (doesn't change power levels based on each bitmap value)
	if(cylOrPln){ //Plane
		var z = objHghtOrDmtr + LASER_FOCUS_DISTANCE; //For plane the z is a constant height
		for(var bmY=0; bmY<COLUMN_HEIGHT; bmY++){
			for(var bmX=0; bmX<ROW_WIDTH; bmX){
				if(bitMap[bmX][bmY] ^ laserOn){ //True if change in state
					//Send G-code with xy value (z and angle(0) value will be the same for each instance),  
					//power is turned on when laserOn is true.
					txbuf.fill(0); //Clear Buffers
					rxbuf.fill(0);
					txString = "G1X" + bmX + "Y" + bmY + "Z" + z + "S" + (laserOn*bitMap[bmX][bmY]); //*** add to us rapid mode(G0) when laser is off 
					rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
					laserOn = laserOn ^ TRUE; //toggle
					//if(rxbuf){} //***Check for errors from stm32f0
				}
			}
		}
	}
	else{ //Cylinder
		for(var bmZ=0; bmZ<COLUMN_HEIGHT; bmZ++){
			for(var bmX=0; bmX<ROW_WIDTH; bmX){
				if(bitMap[bmX][bmZ] ^| laserOn){ 
					//Send G-code with xyz value and the center of rotation 
					//power is turned on when laserOn is true.
					txbuf.fill(0); //Clear Buffers
					rxbuf.fill(0);
 					txString = "G3X" + x + "Y" + y + "Z" + z + "E" + angle + "S" + power;
					rpio.spiTransfer(txbuf.fill(txString,0,txString.length), rxbuf, SPI_STR_LENGTH);
					laserOn = laserOn ^ TRUE; //toggle laserOn
				}
			}
		}
	}
	// Sample arc command:  G2 or G3 <X- Y- Z- I- J- P->
	//Z - helix
	//I - X offset
	//J - Y offset
	//P - number of turns


}


/* 
	Send G-Code
	Description: Depending on wether a cylinder or plane is being engraved this function
	will ***
*/
function sendGcode(cylOrPln, x, y, z, angle, power){ 

	txbuf.fill(0); //Clear buffers
	rxbuf.fill(0);

	//*** still need to adapt firmware for E to move gimbal stepper. 
	//Command string tells engraver to move to XYZE position (G1) 
	//M3 Constant laser power on, M4 dynamic laser power on (auto turns laser off when not moving) 
	//Stay there for dwell time (G4 P[dwell])
	//To turn laser off (M5)
	//S is laser power (gcode it is called spindle speed)  
	
	if(cylOrPln){ //Plane
		var txString = "G1 X" + x + " Y" + x + " Z" + z + " S" + power;
	}
	else{ //Cylinder 	
		var txString = "G1 X" + x + " Y" + y + " Z" + z + " E" + angle + " S" + power;
	}
	
	rpio.spiTransfer(txbuf, rxbuf, SPI_STR_LENGTH);
}


module.exports = app;
