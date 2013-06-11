var net = require('net');
var events = require('events');
var util = require('util');
var openpass = require('./openpass');

var MODE_MONITOR = 0;
var MODE_COMMAND = 1;
var MODE_STR = [ 'MON', 'CMD' ];
var DIR_IN = 0;
var DIR_OUT = 1;
var DIR_STR = ['<=','=>'];

var STATE_UNCONNECTED = 0;
var STATE_CONNECTING = 1;
var STATE_LOGGING_IN = 2;
var STATE_CONNECTED = 3;
var PKT_ACK = '*#*1##';
var PKT_NACK = '*#*0##'; 
var PKT_START_COMMAND = '*99*9##';
var PKT_START_MONITOR = '*99*1##';

//=============================================================================

/* layer 1 of the connection th OpenWebNet
 * handles all the details of logging in the gateway
 * then, starts returning all packets to parent object
 */ 

var myHomeConn = function (params) {
	events.EventEmitter.call (this);
	var self = this;
	var mode = params.mode;
	var state = STATE_UNCONNECTED;
	
	function logPacket (direction, packet) {
		var now = new Date();
		
		console.log (now.toISOString()+' - '+MODE_STR[mode]+' '+DIR_STR[direction]+' '+packet);		
	}
	
	/*
	 * send a packet through the connection
	 */
	this.sendPacket = function (pkt) {
		logPacket(DIR_OUT, pkt);
		conn.write (pkt);
	};
	
	/*
	 * parse the basics of the incoming packets
	 */
	this.parseMyOpenPacket = function (data) {
		var sdata = data.toString();
		
		/* TODO: handle the fact that more that one packet can come in at the same time */
		
		logPacket (DIR_IN, sdata);
		switch (state) {
			case STATE_UNCONNECTED:
				/* initial ack from gateway */
				if (sdata==PKT_ACK) {
					self.emit ('connecting');
					state = STATE_CONNECTING;
					switch (mode) {
						case MODE_MONITOR:
							self.sendPacket (PKT_START_MONITOR);
							break;
						case MODE_COMMAND:
							self.sendPacket (PKT_START_COMMAND);
							break;
					}						
				}
				break;
			case STATE_CONNECTING:
				if (sdata==PKT_ACK) {
					/* connected already */
					/* state should be STATE_CONNECTED at this point, I guess */
				} else {
					/* probably need to login */
					/* login nonce is of the form *#<numbers>## */
					var m = sdata.match(/\*#(\d+)##/);
					if (m===null) {
						/* no match ? */
						console.log ('unable to recognize packet \''+sdata+'\'');
					} else {	
						self.emit ('logging-in');
						/* nonce is first captured string from regexp */
						var p = openpass.calcPass(params.pass, m[1]);
						state = STATE_LOGGING_IN;
						self.sendPacket('*#'+p+'##');
					}
				}
				break;
			case STATE_LOGGING_IN :
				if (sdata==PKT_ACK) {
					self.emit ('connected');
					state = STATE_CONNECTED;
				} else {
					console.log ('got unexpected packet');
				}
				break;
			case STATE_CONNECTED :
				/* handle packets */
				self.emit ('packet', sdata);
				break;
		}
	};
	
	/*
	 * half-closes the connection.
	 * server can still send stuff that will get received 
	 */
	this.end = function () {
		conn.end();
	}
	
	/* TODO: catch EADDRNOTAVAIL - device not present */
	var conn = net.connect(params);
	conn.on ('data', self.parseMyOpenPacket);	
};
util.inherits(myHomeConn, events.EventEmitter);	

//=============================================================================

/* layer 2 of the connection to myhome
 * starts initially with a monitor connection
 */ 

var myHomeEngine = function (params) {
	events.EventEmitter.call (this);
	
	/* the params object contains the following :
	 * params.command : the command to be sent
	 * params.stopon  : packets to stop on
	 * params.packet  : callback for each packet
	 * params.done	  : callback for when we're at the end
	 */
	this.sendCommand = function (params) {
		/* connects to the same device as the parent connection */
		var connparams = {
			"host": host,
			"port": port,
			"pass": pass,
			"mode": MODE_COMMAND
		};
		
		var commandconn = new myHomeConn (connparams);
		commandconn.on ('connected', function () {	
			commandconn.sendPacket (params.command);
		});
		commandconn.on ('packet', function (data) {
			/* check if data is in stopon variable */
			commandconn.end();
			if (params.packet) 
				params.packet(data);
		});
	};
	
	var self = this;
	
	/* check parameters */
	var host;
	var port;
	var pass;
	if (params) {
		host = params.host;
		port = params.port;
		pass = params.pass;
	}

	/* default values */
	if (host===undefined)
		host = '192.168.0.35';
	if (port===undefined) 
		port = 20000;
	if (pass===undefined)
		pass = '12345';
	
	/* set up connection parameters */
	params = {
		"host": host,
		"port": port,
		"pass": pass,
		"mode": MODE_MONITOR
	};
	
	/* start the connection to the myhome gateway */	
	var monitor = new myHomeConn (params);
	monitor.on('connected', function () {
		self.emit ('monitoring');
	});
};
util.inherits(myHomeEngine, events.EventEmitter);	

//=============================================================================



exports.PKT_ACK = PKT_ACK;
exports.PKT_NACK = PKT_NACK;
exports.engine = myHomeEngine;