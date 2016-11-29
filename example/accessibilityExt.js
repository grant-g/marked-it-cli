var html = {};

var CAPTION = "caption";
var CAPTION_SIDE = "caption-side";

html.onTable = function(html, data) {
	var table = data.htmlToDom(html);
	var captionText = table.attribs[CAPTION];
	if (!captionText) {
		return; /* nothing to do */
	}

	var captionSide = table.attribs[CAPTION_SIDE];
	delete table.attribs[CAPTION];
	delete table.attribs[CAPTION_SIDE];

	var caption = data.htmlToDom("<caption>" + captionText + "</caption>");
	if (captionSide) {
		caption.attribs[CAPTION_SIDE] = captionSide;
	}
	
	/* the <caption> _must_ be the first child of the <table> */
	var children = data.domUtils.getChildren(table);
	data.domUtils.prepend(children[0], caption);

	return data.domToHtml(table);
}

module.exports.html = html;
module.exports.id = "accessibility";
