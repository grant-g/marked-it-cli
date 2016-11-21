/*******************************************************************************
 * Copyright (c) 2014, 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

var CRITICAL = 0;
var ERROR = 1;
var WARNING = 2;
var INFO = 3;
var DEBUG = 4;

function Logger(level, id) {
	this.level = level;
	this.prefix = id ? "[" + id + "] " : "";
}

Logger.prototype = {
	critical: function(text) {
		text = text.replace(/\n/g, "\n***");
		console.log("\n***CRITICAL: " + this.prefix + text + " ***\n");
	},
	error: function(text) {
		if (ERROR <= this.level) {
			text = text.replace(/\n/g, "\n***");
			console.log("\n***ERROR: " + this.prefix + text + "\n");
		}
	},
	warning: function(text) {
		if (WARNING <= this.level) {
			text = text.replace(/\n/g, "\n*");
			console.log("*WARNING: " + this.prefix + text);
		}
	},
	info: function(text) {
		if (INFO <= this.level) {
			console.log(this.prefix + text);
		}
	},
	important: function(text) {
		/* important but not an error, don't filter on the logger's level */
		console.log("\n" + this.prefix + text + "\n");
	},
	debug: function(text) {
		if (DEBUG <= this.level) {
			console.log("--> " + this.prefix + text);
		}
	},
	createChild: function(id) {
		return new Logger(this.level, id);
	}
};

module.exports.Logger = Logger;
module.exports.CRITICAL = CRITICAL;
module.exports.ERROR = ERROR;
module.exports.WARNING = WARNING;
module.exports.INFO = INFO;
module.exports.DEBUG = DEBUG;
