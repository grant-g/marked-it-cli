/**
 * marked-it-cli
 *
 * Copyright (c) 2014, 2017 IBM Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

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
