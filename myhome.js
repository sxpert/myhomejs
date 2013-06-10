var net = require('net');
var events = require('events');
var util = require('util');
var openpass = require('./openpass');

var MODE_MONITOR = 0;
var MODE_COMMAND = 1;
var MODE_STR = [ 'MON', 'CMD' ];

var STATE_UNCONNECTED = 0;
var STATE_CONNECTING = 1;
var STATE_LOGGING_IN = 2;
var STATE_CONNECTED = 3;
var PKT_ACK = '*#*1##';
var PKT_NACK = '*#*0##'; 
var PKT_START_COMMAND = '*99*9##';
var PKT_START_MONITOR = '*99*1##';

/******************************************************************************
 *
 * handles the lower layer of the connection
 *
 */ 

var myHomeConn = function (params) {
	events.EventEmitter.call (this);
	var self = this;
	var mode = params.mode;
	var state = STATE_UNCONNECTED;
		
	this.sendPacket = function (pkt) {
		console.log (MODE_STR[mode]+' -> '+pkt);
		conn.write (pkt);
	};
	this.parseMyOpenPacket = function (data) {
		var sdata = data.toString();
		console.log(MODE_STR[mode]+' <- '+state+' - \''+sdata+'\'');
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
	this.end = function () {
		conn.end();
	}
	
	/* TODO: catch EADDRNOTAVAIL - device not present */
	var conn = net.connect(params, function () {
		console.log ('client connected');
	});
	conn.on ('data', self.parseMyOpenPacket);	
};
util.inherits(myHomeConn, events.EventEmitter);	

/******************************************************************************
 *
 * handles the layer 2 of the connection
 *
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
		console.log ('requesting system status');
		/* connects to the same device as the parent connection */
		var connparams = {
			"host": host,
			"port": port,
			"pass": pass,
			"mode": MODE_COMMAND
		};
		
		var commandconn = new myHomeConn (connparams);
		commandconn.on ('connected', function () {	
			console.log ('connected in command mode');
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
	console.log ('myhome module starting');
	var host;
	var port;
	var pass;
	if (params) {
		host = params.host;
		port = params.port;
		pass = params.pass;
	}
	if (host===undefined)
		host = '192.168.0.35';
	if (port===undefined) 
		port = 20000;
	if (pass===undefined)
		pass = '12345';
	
	console.log (host);
	console.log (port);
	params = {
		"host": host,
		"port": port,
		"pass": pass,
		"mode": MODE_MONITOR
	};
	var monitor = new myHomeConn (params);
	monitor.on('connecting', function () {
		console.log ('connecting to gateway');
	});
	monitor.on('logging-in', function () {
		console.log ('logging in gateway');	
	});
	monitor.on('connected', function () {
		self.emit ('monitoring');
	});
};
util.inherits(myHomeEngine, events.EventEmitter);	

exports.PKT_ACK = PKT_ACK;
exports.PKT_NACK = PKT_NACK;
exports.engine = myHomeEngine;