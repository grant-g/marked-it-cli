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

var fs = require("fs");
var htmlparser = require("htmlparser2");

function domToHtml(dom, options) {
	return htmlparser.DomUtils.getOuterHTML(dom, options || {});
}

function domToInnerHtml(dom, options) {
	return htmlparser.DomUtils.getInnerHTML(dom, options || {});
}

function htmlToDom(string, options) {
	var result;
	var handler = new htmlparser.DomHandler(function(error, dom) {
	    if (error) {
	        console.log("*** Failed to parse HTML:\n" + error.toString());
	    } else {
	        result = dom;
	    }
	});
	var parser = new htmlparser.Parser(handler, options || {});
	parser.write(string.trim());
	parser.done();

	return result;
}

function invokeExtensions(extensions, id, string, data) {
	if (!extensions) {
		return string;
	}

	var endNL = /(\r\n|\r|\n)$/.exec(string);

	var current = extensions;
	var segments = id.split(".");
	for (var i = 0; current && i < segments.length; i++) {
		current = current[segments[i]];
	}

	if (current) {
		var extensionsArray;
		if (current instanceof Array) {
			extensionsArray = current;
		} else if (current instanceof Function) {
			extensionsArray = [current];
		}

		if (extensionsArray) {
			extensionsArray.forEach(function(current) {
				var result = current(string, data);
				if (typeof(result) === "string") {
					string = result;
				}
			});
		}
	}

	if (string && endNL && !(new RegExp(endNL[1] + "$")).test(string)) {
		string += endNL[1];
	}
	return string;
}

function readFile(fd) {
	if (typeof(fd) !== "number") {
		return null;
	}

	var readStat = fs.fstatSync(fd);
	var readBlockSize = readStat.blksize || 4096;
	var fileSize = readStat.size;
	if (!fileSize) {
		return "";
	}
	var inBuffer = new Buffer(fileSize);
	var totalReadCount = 0;
	do {
		var length = Math.min(readBlockSize, fileSize - totalReadCount);
		var readCount = fs.readSync(fd, inBuffer, totalReadCount, length, null);
		if (!readCount) {
			break;
		}
		totalReadCount += readCount;
	} while (totalReadCount < fileSize);
	if (totalReadCount !== fileSize) {
		return null;
	}
	var result = inBuffer.toString("utf8", 0, inBuffer.length);
	result = result.replace(/^\uFEFF/, ""); /* strip contained BOM characters */
	return result;
}

function writeFile(fd, buffer) {
	var writeStat = fs.fstatSync(fd);
	var writeBlockSize = writeStat.blksize || 4096;
	var totalWriteCount = 0;
	do {
		var length = Math.min(writeBlockSize, buffer.length - totalWriteCount);
		var writeCount = fs.writeSync(fd, buffer, totalWriteCount, length, null);
		if (!writeCount) {
			return false;
		}
		totalWriteCount += writeCount;
	} while (totalWriteCount < buffer.length);
	return true;
}

module.exports.domToHtml = domToHtml;
module.exports.domToInnerHtml = domToInnerHtml;
module.exports.htmlToDom = htmlToDom;
module.exports.domUtils = htmlparser.DomUtils;
module.exports.invokeExtensions = invokeExtensions;
module.exports.readFile = readFile;
module.exports.writeFile = writeFile;
