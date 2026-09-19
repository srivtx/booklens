import { mkdirSync, writeFileSync } from "node:fs";
import { buildEpub } from "../src/zip";

const OPF_PATH = "OEBPS/content.opf";
const IDENTIFIER = "urn:uuid:00000000-0000-0000-0000-000000000001";

const COVER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1">
  <rect width="1" height="1" fill="#000000"/>
</svg>
`;

function containerXml(opfPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

export function makeInaccessibleEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
        <li><a href="chapter1.xhtml">Chapter One</a></li>
        <li><a href="chapter2.xhtml">Chapter Two</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <h3>Skipped Heading Level</h3>
    <img src="cover.svg" />
    <p>Read more at <a href="https://example.com">https://example.com</a>.</p>
    <table>
      <tr><td>Alpha</td><td>Beta</td></tr>
    </table>
  </body>
</html>
`;

  const chapter2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter Two</title>
  </head>
  <body>
    <h1>Chapter Two</h1>
    <h3>Another Skipped Level</h3>
    <img src="cover.svg" />
    <p>Source: <a href="https://example.org">https://example.org</a></p>
    <table>
      <tr><td>Gamma</td><td>Delta</td></tr>
    </table>
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/nav.xhtml", data: nav },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
    { path: "OEBPS/chapter2.xhtml", data: chapter2 },
    { path: "OEBPS/cover.svg", data: COVER_SVG },
  ]);
}

export function makeGoodEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
    <dc:title>An Accessible Book</dc:title>
    <dc:language>en</dc:language>
    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">This publication contains accessible content.</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
        <li><a href="chapter1.xhtml">Chapter One</a></li>
        <li><a href="chapter2.xhtml">Chapter Two</a></li>
      </ol>
    </nav>
    <nav epub:type="landmarks" id="landmarks">
      <ol>
        <li><a epub:type="bodymatter" href="chapter1.xhtml">Start of Content</a></li>
      </ol>
    </nav>
    <nav epub:type="page-list" id="page-list">
      <ol>
        <li><a href="chapter1.xhtml#page1">1</a></li>
        <li><a href="chapter2.xhtml#page2">2</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <h2>Section</h2>
    <img src="cover.svg" alt="A black square"/>
    <p>Read more on our site.</p>
    <table>
      <tr><th scope="col">Alpha</th><th scope="col">Beta</th></tr>
    </table>
  </body>
</html>
`;

  const chapter2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Chapter Two</title>
  </head>
  <body>
    <h1>Chapter Two</h1>
    <h2>Another Section</h2>
    <img src="cover.svg" alt="A black square"/>
    <p>Source: our documentation.</p>
    <table>
      <tr><th scope="col">Gamma</th><th scope="col">Delta</th></tr>
    </table>
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/nav.xhtml", data: nav },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
    { path: "OEBPS/chapter2.xhtml", data: chapter2 },
    { path: "OEBPS/cover.svg", data: COVER_SVG },
  ]);
}

export function makeNoNavEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
    <dc:title>No Nav</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <img src="cover.svg" alt="A black square"/>
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
    { path: "OEBPS/cover.svg", data: COVER_SVG },
  ]);
}

export function makeNcxEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
    <dc:title>NCX Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
  </spine>
</package>
`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${IDENTIFIER}"/>
  </head>
  <docTitle><text>NCX Book</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <p>Body text.</p>
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/toc.ncx", data: ncx },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
  ]);
}

// EPUB2/NCX book whose spine document uses HTML-style void elements
// (`<br>`, `<img>`) and an image without alt. Fixing E008/E009 rewrites this
// document, so it is the regression case for XML-safe serialization.
export function makeXmlUnsafeNcxEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
    <dc:title>Void Tag Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
  </spine>
</package>
`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${IDENTIFIER}"/>
  </head>
  <docTitle><text>Void Tag Book</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <p>Line one<br>Line two &#160; end</p>
    <img src="cover.svg">
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/toc.ncx", data: ncx },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
    { path: "OEBPS/cover.svg", data: COVER_SVG },
  ]);
}

export function makeSingleQuoteNavEpub(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${IDENTIFIER}</dc:identifier>
    <dc:title>Single Quotes</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.svg" media-type="image/svg+xml"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>
`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>Contents</title>
  </head>
  <body>
    <nav epub:type='toc' id='toc'>
      <ol>
        <li><a href='chapter1.xhtml'>Chapter One</a></li>
      </ol>
    </nav>
    <nav epub:type='landmarks' id='landmarks'>
      <ol>
        <li><a epub:type='bodymatter' href='chapter1.xhtml'>Start of Content</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>Chapter One</title>
  </head>
  <body>
    <h1>Chapter One</h1>
    <span epub:type="pagebreak" id="p1">1</span>
    <img src="cover.svg" alt="A black square"/>
  </body>
</html>
`;

  return buildEpub([
    { path: "META-INF/container.xml", data: containerXml(OPF_PATH) },
    { path: OPF_PATH, data: opf },
    { path: "OEBPS/nav.xhtml", data: nav },
    { path: "OEBPS/chapter1.xhtml", data: chapter1 },
    { path: "OEBPS/cover.svg", data: COVER_SVG },
  ]);
}

if (import.meta.main) {
  const fixturesDir = new URL("../fixtures/", import.meta.url);
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(new URL("inaccessible.epub", fixturesDir), makeInaccessibleEpub());
  writeFileSync(new URL("good.epub", fixturesDir), makeGoodEpub());
  console.log("Wrote fixtures/inaccessible.epub and fixtures/good.epub");
}
