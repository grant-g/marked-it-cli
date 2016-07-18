/*******************************************************************************
 * Copyright (c) 2016 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

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
	if (!queue.length) {
		callback();
	} else {
		setTimeout(function() {cleanup(callback)}, 1000);
	}
}

module.exports.cleanup = cleanup;
module.exports.copyFile = copyFile;
