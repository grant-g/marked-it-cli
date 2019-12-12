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

var concurrentLimit = process.platform === "win32" ? 128 : Infinity;
var counter = 0;
var queue = [];

function copyFile(sourcePath, destinationPath, logger) {
	if (counter < concurrentLimit) {
		counter++;
		var readStream = fs.createReadStream(sourcePath);
		(function(readStream, sourcePath) {
			readStream.on("error", function(error) {
				logger.warning("Failed to read: " + sourcePath + "\n" + error.toString());
			});
		})(readStream, sourcePath);

		var writeStream = fs.createWriteStream(destinationPath);
		(function(writeStream, sourcePath, destinationPath) {
			writeStream.on("error", function(error) {
				logger.warning("Failed to write: " + destinationPath + "\n" + error.toString());
			});
			writeStream.on("close", function() {
				logger.info("Copied: " + sourcePath);
				counter--;
				if (queue.length) {
					var entry = queue.splice(0, 1)[0];
					copyFile(entry.sourcePath, entry.destinationPath, entry.logger);
				}
			});
		})(writeStream, sourcePath, destinationPath);

		readStream.pipe(writeStream);
	} else {
		queue.push({sourcePath: sourcePath, destinationPath: destinationPath, logger: logger});
	}
}

function cleanup(callback) {
	if (counter === 0) {
		callback();
	} else {
		setTimeout(function() {cleanup(callback);}, 1000);
	}
}

module.exports.cleanup = cleanup;
module.exports.copyFile = copyFile;
