#  Change Log

This project uses [semantic versioning](http://semver.org/).

## [0.9.7] 2018-06-25
Merged fix for example/makeApidocsJson.js.

## [0.9.6] 2018-06-12
Added example/makeApidocsJson.js.

## [0.9.5] 2018-05-10
Fix to skip processing of hidden folders/files.

## [0.9.4] 2018-04-18
Fix to eliminate generation of `<property name="class" value=""/>` elements in toc.xml files.

## [0.9.2] 2018-04-03
Update to example/xmlTocExt.js.

## [0.9.1] 2017-06-27
### New features
Code blocks that identify a source language are now marked up with [highlight.js](https://www.npmjs.com/package/highlight.js) so that they can
render with syntax highlighting.  For example, markdown source:
	```python
	s = "Python syntax highlighting"
	print s
	```

will generate to HTML as:

	<pre>
	<code class="lang-python hljs">
	s = <span class="hljs-string">"Python syntax highlighting"</span>
	<span class="hljs-keyword">print</span> s
	</code>
	</pre>


## [0.9.0] 2017-06-05
### New features
#### Improved toc file nesting
Nesting of items in toc files can now be specified with '>' characters instead of whitespace.  This was done because the previous reliance on whitespace proved to not be reliable, as specified whitespace was not always preserved by copy/paste operations and by display in some web clients.

The following is done to determine the indentation level for a line in a toc file:
1. Capture all leading space and ‘>’ chars.
2. If there are any ‘>’ chars in there then count the number of ‘>’ chars to determine that item’s level.  All contained spaces are consequently considered to be meaningless (useful for formatting only).
3. If there are no ‘>’ chars in there then use the previous approach of counting the number of leading spaces.

The following four hierarchies are equivalent.  They demonstrate different approaches that can be used to define toc file lines with varying hierarchy  readability.

```
root1 (spaces only)
    child1
            childTooDeepError
    child2
        child21
            child211
        child 22

root2 ('>' only)
>child1
>>>childTooDeepError
>child2
>>child21
>>>child211
>>child 22

root3 (all '>' at beginning, spaces are ignored but help with readability)
>    child1
>>>            childTooDeepError
>    child2
>>        child21
>>>            child211
>>        child 22

root4 ('>' at each level, spaces are ignored but help with readability)
>    child1
>    >    >    childTooDeepError
>    child2
>    >    child21
>    >    >    child211
>    >    child 22
```


## [0.8.0] 2017-05-07
Initial release
