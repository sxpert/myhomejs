var net = require('net');
var events = require('events');
var util = require('util');
var openpass = require('./openpass');

var MODE_MONITOR = 0;
var MODE_COMMAND = 1;
var STATE_UNCONNECTED = 0;
var STATE_CONNECTING = 1;
var STATE_LOGGING_IN = 2;
var STATE_CONNECTED = 3;
var PKT_ACK = '*#*1##';
var PKT_NACK = '*#*0##'; 
var PKT_START_MONITOR = '*99*1##';


var myHomeConn = function (params) {
	events.EventEmitter.call (this);
	var self = this;
	var mode = MODE_MONITOR;
	var state = STATE_UNCONNECTED;
	
	this.connectMonitor = function (conn) {
		console.log ('connecting monitor session');
	};
	this.sendPacket = function (pkt) {
		console.log ('-> '+pkt);
		conn.write (pkt);
	};
	this.parseMyOpenPacket = function (data) {
		var sdata = data.toString();
		console.log('<- '+state+' - \''+sdata+'\'');
		switch (state) {
			case STATE_UNCONNECTED:
				/* initial ack from gateway */
				if (sdata==PKT_ACK) {
					self.emit ('connecting');
					state = STATE_CONNECTING;
					self.sendPacket (PKT_START_MONITOR);
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
				break;
		}
	};
	
	/* TODO: catch EADDRNOTAVAIL - device not present */
	var conn = net.connect(params, function () {
		console.log ('client connected');
		self.connectMonitor (conn);
	});
	conn.on ('data', self.parseMyOpenPacket);	
};
util.inherits(myHomeConn, events.EventEmitter);	


var myHomeEngine = function (params) {
	events.EventEmitter.call (this);
	this.test = function () {
		console.log ('testing');
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

exports.engine = myHomeEngine;