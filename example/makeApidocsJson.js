/**
 * marked-it-cli
 *
 * Copyright (c) 2018 IBM Corporation
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

// Usage:
//    ./marked-it-cli ... --extension-file=example/makeApidocsJson.js
//
// File names:
//     "xyz.md" will be processed and added into the corresponding Swagger
//     file "xyz.json" if the latter exists.
//
// Variables:
//    {{swagger.x.y}} in Markdown is replaced with the value of x.y in the
//    Swagger object of "xyz.json".

const common = require('../lib/cli-common');
const fs = require('fs');

// Removes control attributes.
function domToHtml(node) {
  const newNode = Object.assign({}, node);
  newNode.attribs = Object.assign({}, node.attribs);
  delete newNode.attribs['data-hd-position'];
  delete newNode.attribs['id'];
  return common.domToHtml(newNode);
}

function processSubsection(subsection, defaultLanguages, allLanguages) {
  let lang = defaultLanguages;
  let dom = subsection.dom;
  if (dom[0] && dom[0].type === 'tag' && dom[0].name === 'h2') {
    if ('data-hd-programlang' in dom[0].attribs) {
      lang = dom[0].attribs['data-hd-programlang'].split(' ');
      if (lang.includes('generic')) lang = ['generic'];
    }
    if ('data-hd-position' in dom[0].attribs) {
      subsection.position = dom[0].attribs['data-hd-position'];
    }
    dom = dom.slice(1);
  }
  lang.forEach((e) => { allLanguages.add(e); });
  subsection.elements = [];
  dom.forEach((node) => {
    if (node.type === 'text' && node.data === '\n') return;
    if (node.attribs && node.attribs['data-hd-programlang']) {
      node.attribs['data-hd-programlang'].split(' ').forEach((e) => { allLanguages.add(e); });
    } else if (node.attribs && lang[0] !== 'generic') {
      node.attribs['data-hd-programlang'] = lang.join(' ');
    }
    const isCode = node.type === 'tag' && node.name === 'pre' && node.children && node.children.length > 0 && node.children[0].type === 'tag' && node.children[0].name === 'code';
    const type = isCode ? 'code' : 'text';
    subsection.elements.push({type, source: domToHtml(node)});
  });
}

function processSection(section) {
  const allLanguages = new Set();
  let dom = section.dom;
  let lang = ['generic'];
  if (dom[0] && dom[0].type === 'tag' && dom[0].name === 'h1') {
    if ('data-hd-programlang' in dom[0].attribs) {
      lang = dom[0].attribs['data-hd-programlang'].split(' ');
      if (lang.includes('generic')) lang = ['generic'];
    }
    dom = dom.slice(1);
  }
  lang.forEach((e) => { allLanguages.add(e); });
  let pos = 'middle';

  const subsections = [{ dom: [] }];
  dom.forEach((node) => {
    if (node.type === 'tag' && node.name === 'h2') {
      if (subsections[subsections.length - 1].dom.length) {
        subsections.push({ dom: [] });
      }
    }
    subsections[subsections.length - 1].dom.push(node);
  });

  section.blocks = [];
  let block = { content: [], examples: [] };
  subsections.forEach((subsection) => {
    processSubsection(subsection, lang, allLanguages);
    const newPos = (subsection.position === 'right' ? 'right' : 'middle');
    if (newPos !== 'right' && pos === 'right') {
      section.blocks.push(block);
      block = { content: [], examples: [] };
    }
    pos = newPos;
    const subblock = (pos === 'middle' ? block.content : block.examples);
    subsection.elements.forEach((e) => { subblock.push(e); });
  });

  if (block.content.length || block.examples.length) {
    section.blocks.push(block);
  }
  delete section.dom;
  if (allLanguages.size && !allLanguages.has('generic')) {
    section.exclusiveLanguages = Array.from(allLanguages);
  }
}

const html = {};
html.onComplete = (html, data) => {
  const swaggerPath = data.sourcePath.replace(/\.md$/, '.json');
  const localMap = {};
  try {
    localMap.swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
    delete localMap.swagger.info['x-documentation-sections'];
  } catch (e) {
    localMap.swagger = { info: {} };
  }
  const newHtml = data.replaceVariables(html, null, localMap);
  const dom = common.htmlToDom(newHtml);
  const sections = [{ dom: [] }];
  dom.forEach((node) => {
    if (node.type === 'tag' && node.name === 'h1') {
      sections.push({
        name: common.domToInnerHtml(node),
        id: node.attribs['id'],
        dom: [],
      });
    }
    sections[sections.length - 1].dom.push(node);
  });

  sections.forEach((section) => { processSection(section); });
  localMap.swagger.info['x-documentation-sections'] = sections;
  const outData = JSON.stringify(localMap.swagger, null, 2);
  fs.writeFileSync(swaggerPath, outData);
}
module.exports.html = html;
module.exports.id = "makeApidocsJson";
