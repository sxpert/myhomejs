var net = require('net');
var events = require('events');
var util = require('util');
var openpass = require('./openpass');

var MODE_MONITOR = 0;
var MODE_COMMAND = 1;
var MODE_CONFIG = 2;
var MODE_STR = [ 'MON', 'CMD', 'CNF' ];
var DIR_IN = 0;
var DIR_OUT = 1;
var DIR_STR = ['<=','=>'];

var STATE_UNCONNECTED = 0;
var STATE_CONNECTING = 1;
var STATE_LOGGING_IN = 2;
var STATE_CONNECTED = 3;
var PKT_ACK = '*#*1##';
var PKT_NACK = '*#*0##';
var PKT_START_CONFIG = '*99*0##'; 
var PKT_START_COMMAND = '*99*9##';
var PKT_START_MONITOR = '*99*1##';

//=============================================================================

/* layer 1 of the connection to OpenWebNet
 * handles all the details of logging in the gateway
 * then, starts returning all packets to parent object
 */ 

var myHomeLayer1 = function (params) {
	events.EventEmitter.call (this);
	var self = this;
	var mode = params.mode;
	self.log = params.log;
	var state = STATE_UNCONNECTED;
	
	this._logPacket = function (string) {
		console.log (string);
	};
	
	this.pktToString = function (direction, packet) {
		var now = new Date();
		return now.toISOString()+' - '+MODE_STR[mode]+' '+DIR_STR[direction]+' '+packet;
	};
	
	this.logPacket = function (direction, packet) {
		if (self.log) {
			self._logPacket (self.pktToString(direction,packet));
		}
	};
	
	/*
	 * send a packet through the connection
	 */
	this.sendPacket = function (pkt) {
		self.logPacket(DIR_OUT, pkt);
		self.conn.write (pkt);
	};
	
	/*
	 * parse the basics of the incoming packets
	 */
	this.parseMyOpenPacket = function (data) {
		var sdata = data.toString();
		
		/* handle the fact that more that one packet can come in at the same time */
		while (sdata.length>0) {
			var m = sdata.match(/(\*.+?##)(.*)/);
			/* first packet is m[1], rest is m[2] */
			packet = m[1];
			sdata = m[2];

			self.logPacket (DIR_IN, packet);
			switch (state) {
				case STATE_UNCONNECTED:
					/* initial ack from gateway */
					if (packet==PKT_ACK) {
						self.emit ('connecting');
						state = STATE_CONNECTING;
						switch (mode) {
							case MODE_MONITOR:
								self.sendPacket (PKT_START_MONITOR);
								break;
							case MODE_COMMAND:
								self.sendPacket (PKT_START_COMMAND);
								break;
							case MODE_CONFIG:
								self.sendPacket (PKT_START_CONFIG);
								break;
						}						
					}
					break;
				case STATE_CONNECTING:
					if (packet==PKT_ACK) {
						/* connected already */
						/* state should be STATE_CONNECTED at this point, I guess */
						self.emit ('connected');
						state = STATE_CONNECTED;
					} else {
						/* probably need to login */
						/* login nonce is of the form *#<numbers>## */
						m = packet.match(/\*#(\d+)##/);
						if (m===null) {
							/* no match ? */
							console.log ('unable to recognize packet \''+packet+'\'');
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
					if (packet==PKT_ACK) {
						self.emit ('connected');
						state = STATE_CONNECTED;
					} else {
						console.log ('got unexpected packet');
					}
					break;
				case STATE_CONNECTED :
					/* handle packets */
					self.emit ('packet', packet);
					break;
			}
		}
	};
	
	/*
	 * half-closes the connection.
	 * server can still send stuff that will get received 
	 */
	this.end = function () {
		this.conn.end();
	}
	
	/* TODO: catch EADDRNOTAVAIL - device not present */
	this.conn = net.connect(params);
	this.conn.on ('data', self.parseMyOpenPacket);	
};
util.inherits(myHomeLayer1, events.EventEmitter);	

//=============================================================================

/* layer 2 of the connection to myhome
 * starts initially with a monitor connection
 */ 

var myHomeLayer2 = function (params) {
	events.EventEmitter.call (this);
	
	/* the params object contains the following :
	 * params.command : the command to be sent
	 * params.stopon  : packets to stop on
	 * params.packet  : callback for each packet
	 * params.done	  : callback for when we're at the end
	 */
	this.sendCommand = function (params) {
		if (params)
			if (params.log!==undefined)
				var log = params.log;
			var mode = MODE_COMMAND;
			if (params.mode!==undefined)
				mode = params.mode;
		/* connects to the same device as the parent connection */
		var connparams = {
			"host": host,
			"port": port,
			"pass": pass,
			"mode": mode,
			"log" : log,
		};
		var commandconn = new myHomeLayer1 (connparams);
		commandconn.on ('connected', function () {	
			commandconn.sendPacket (params.command);
		});
		commandconn.on ('packet', function (data) {
			function done (data, index) {
				commandconn.end();
				if (params.done)
					params.done(data, index);
			}
			/* check if data is in stopon variable */
			if (params.stopon!==undefined) {
				if (Array.isArray(params.stopon)) {
					var i = params.stopon.indexOf(data);
					if (i!=-1)	return done (data, i);
				} else if (data==params.stopon) 
					return done (data, 0);
			} 
			if (params.packet) 
				params.packet(commandconn, data);
		});
	};
	

	
	var self = this;
	
	/* check parameters */
	var host;
	var port;
	var pass;
	var log;
	if (params) {
		host = params.host;
		port = params.port;
		pass = params.pass;
		log  = params.log;
	}

	/* default values */
	if (host===undefined)
		host = '192.168.0.35';
	if (port===undefined) 
		port = 20000;
	if (pass===undefined)
		pass = '12345';
	if (log===undefined)
		log = true;
	
	/* set up connection parameters */
	params = {
		"host": host,
		"port": port,
		"pass": pass,
		"mode": MODE_MONITOR,
		"log" : log,
	};
	
	this.params = function () {
		return {host: host, port: port, pass: pass};
	}
	
	/* start the connection to the myhome gateway */	
	this.monitor = new myHomeLayer1 (params);
	this.monitor.on('connected', function () {
		self.emit ('monitoring');
	});
	this.monitor.on('packet', function (data) {
		self.emit ('packet', data);
	});

};
util.inherits(myHomeLayer2, events.EventEmitter);	

//=============================================================================

/*
 * system level layer
 * advanced functionnality
 */
 
 var myHomeLayer3 = function (params) {
 	events.EventEmitter.call (this);

	var self = this;
	
	this.layer2 = new myHomeLayer2(params);
	this.layer1 = this.layer2.monitor;
	this.sendCommand = this.layer2.sendCommand;
	
	//============================================================================
	
	/*
	 * private function to scan the system for 
	 * the available mac addresses
	 */
	function _scanSystem (params) {
		// state variable
		var SCAN_INIT = 0;
		var SCAN_RECEIVE = 1;
		var state = SCAN_INIT;
		var macs = [];
		if (params)
			if (params.log!==undefined)
				var log = params.log;
		var l2p = self.layer2.params();
		connparams = {
			"host": l2p.host,
			"port": l2p.port,
			"pass": l2p.pass,
			"mode": MODE_CONFIG,
			"log" : log,
		};
		var confconn = new myHomeLayer1 (connparams);
		confconn.on ('connected', function () {	
			confconn.sendPacket ('*1001*12*0##');
		});
		confconn.on ('packet', function (pkt) {
			switch (state) {
				case SCAN_INIT:
					// expecting PKT_ACK at this point.
					if (pkt==PKT_ACK) {
						state = SCAN_RECEIVE;
						// send the start scan command
						confconn.sendPacket (params.cmd);
					} else {
						console.log ('unexpected packet expected \''+PKT_ACK+'\' got\''+pkt+'\'');
					}
					break;
				case SCAN_RECEIVE:
					if (pkt==PKT_ACK) {
						// all done.
						confconn.end();
						if (params.done) 
							return params.done (macs);
					} else {
						var m = pkt.match(/\*#(\d+)\*(\d+)\*(\d+)\*(\d+)##/);
						macs.push(parseInt(m[4],10));
					}
					break;
			}
		});
	};
	
	/*
	 * callable system scanning functions
	 */
	this.scanSystem = function (log, callback) {
		_scanSystem({log: log, cmd: '*#1001*0*13##', done: callback});
	}	
	this.scanUnconfigured = function (log, callback) {
		_scanSystem({log: log, cmd: '*#1001*0*13#0##', done: callback});
	}		
	this.scanConfigured = function (log, callback) {
		_scanSystem({log: log, cmd: '*#1001*0*13#1##', done: callback});
	}
	/*
	 * callable system config functions
	 */

	this.getZones = function (callback) {
	/* NOTE: I was hoping this would return a list of zones but it does not work for me
	 *getZones calls callback(zones, success) function:
	 * zones is an object of zones
	 * success is 1: ack, 2: nack
	 */
		var zones = {};
		this.sendCommand({
			/* command:'*#1004*#0*21##', */
			command:'*#4*001*0##',
                      	stopon: ['*#*1##', '*#*0##'],
			packet: function(cc,pkt) {
console.log('got:'+pkt);
				var m;
				m = pkt.match(/^\*#1004\*#(\d+)\*21\*(\d*)##/);
				if (m!==null) {
					/* Zone operation temperature not adjust by local offset.
					 * m[1] = zone
					 * m[2] = BITS
					 *  BIT field is composed by BIT1 ... BIT16. The most important bits are:
					 *    Bit11 = 0 a probe does not answer
					 *    Bit12 = 0 a pump does not answer
					 *    Bit13 = 0 EEPROM read/write failure
					 *    Bit14 = 0 temperature out of range
					 *    Bit15 = 0 a slave probe does not answer
					 *    Bit16 = 0 an actuator does not answer
					 */
					zones[m[1]] = m[2];
					return;
				}
			},
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail= m[1]; /* 1 = ack, 0 = nack */
				callback(zones, successFail);
			}
                });
	}

	this.getStatus = function (zone, callback) {
	/* getStatus calls callback(status, success) function:
	 * status is like this:
	 * { opTemp: '0185',
	 *   opTempWithOffset: '0190',
	 *   opMode: '1',
	 *   setPointTemp: '0190',
	 *   offsetKnob: '00' }
	 * success is 1: ack, 2: nack
	 */
		var statusResponse = {};
		this.sendCommand({
			command:'*#4*'+zone+'##', /* *#4*where## */
                      	stopon: ['*#*1##', '*#*0##'],
			packet: function(cc,pkt) {
				var m;
				m = pkt.match(/^\*#4\*(\d+)\*0\*(\d+)##/);
				if (m!==null) {
					/* Zone operation temperature not adjust by local offset.
					 * m[1] = zone
					 * m[2] = 0000 to 0500 degrees in .1 degree
					 */
					statusResponse.opTemp = m[2];
					return;
				}
				m = pkt.match(/^\*#4\*(\d+)\*12\*(\d+)\*3##/);
				if (m!==null) {
					/* Zone operation temperature with adjust by local offset
					 * m[1] = zone
                                         * m[2] = 0020 to 0430 degrees in .1 degree
                                         */
					statusResponse.opTempWithOffset = m[2];
					return;
				}
				m = pkt.match(/^\*4\*(\d+)\*(\d+)##/);
				if (m!==null) {
					/* Zone operation mode
					 * m[2] = zone
                                         * m[1] = mode
					 *   0 Conditioning
					 *   1 Heating
					 *   102 Antifreeze
					 *   202 Thermal Protection
					 *   303 Generic OFF
                                         */
					statusResponse.opMode = m[1];
					return;
				}
				m = pkt.match(/^\*#4\*(\d+)\*13\*(\d+)##/);
				if (m!==null) {
					/* Zone local offset
					 * m[1] = zone
                                         * m[2] = offset
					 *   00 knob on 0
					 *   01 knob on +1 (degree)
					 *   11 knob on -1 (degree)
					 *   02 knob on +2 (degree)
					 *   12 knob on -2 (degree)
					 *   03 knob on +3 (degree)
					 *   13 knob on -3 (degree)
					 *   4 knob on Local OFF
					 *   5 knob on Local protection
                                         */
					statusResponse.offsetKnob = m[2];
					return;
				}
				m = pkt.match(/^\*#4\*(\d+)\*14\*(\d+)\*3##/);
				if (m!==null) {
					/* Zone set point temperature
					 * m[1] = zone
					 * m[2] = 0050 to 0400 degrees in .1 degree
					 */
					statusResponse.setPointTemp = m[2];
					return;
				}
				
			},
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail= m[1]; /* 1 = ack, 0 = nack */
				callback(statusResponse, successFail);
			}
                });
	}
	
	this.setTemp = function (temp) {
		this.sendCommand({
			/* Manual setting of “N” zone to T temperature
			 * *#4*where*#14*T*M##
			 * T = 0050 to 0400
			 * M = 1 heating
			 *     2 air-conditioning
			 *     3 generic
			 */
			command:'*#4*1*#14*'+temp+'*1##', 
                      	stopon: ['*#*1##', '*#*0##'],
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail = m[1];
				callback(statusResponse, successFail);
			}
                });
	}
	
	this.setModeOff = function () {
		this.sendCommand({
			/* Set the “N” zone in off mode
			 * *4*303*where##
			 */
			command:'*4*303*1##', 
                      	stopon: ['*#*1##', '*#*0##'],
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail = m[1];
				callback(statusResponse, successFail);
			}
                });
	}
	
	this.setModeAntifreeze = function () {
		this.sendCommand({
			/* Set the “N” zone in antifreeze mode
			 * *4*102*where##
			 */
			command:'*4*102*1##', 
                      	stopon: ['*#*1##', '*#*0##'],
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail = m[1];
				callback(statusResponse, successFail);
			}
                });
	}
	
	this.setModeAuto = function () {
		this.sendCommand({
			/* Set the “N” zone in automatic mode
			 * *4*311*where##
			 */
			command:'*4*311*#1##', 
                      	stopon: ['*#*1##', '*#*0##'],
			done: function(pkt,i) {
				var m = pkt.match(/\*#\*(\d)##/);
				var successFail = m[1];
				callback(statusResponse, successFail);
			}
                });
	}
	
	//============================================================================
	
	this.layer2.on('monitoring', function () {
		self.emit('monitoring');
	});
	this.layer2.on('packet', function (data) {
		// parse packet if we can...
		self.emit ('packet', data);
	});
};
util.inherits(myHomeLayer3, events.EventEmitter);	

exports.MODE_MONITOR = MODE_MONITOR;
exports.MODE_COMMAND = MODE_COMMAND;
exports.MODE_CONFIG = MODE_CONFIG;
exports.PKT_ACK = PKT_ACK;
exports.PKT_NACK = PKT_NACK;
exports.engine = myHomeLayer3;

