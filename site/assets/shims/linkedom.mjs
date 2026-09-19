/* Browser shim for the `linkedom` package.
 *
 * The library uses linkedom only to parse XHTML spine documents and to
 * serialize them back after a fix. In the browser the platform already
 * provides both capabilities, so this shim maps `parseHTML` onto the native
 * DOMParser and guarantees the returned document can be serialized. */

export function parseHTML(html) {
  var source = html === null || html === undefined ? "" : String(html);
  var document = new DOMParser().parseFromString(source, "text/html");

  var serialize = function () {
    return document && document.documentElement
      ? document.documentElement.outerHTML
      : "";
  };

  try {
    if (
      typeof document.toString !== "function" ||
      document.toString === Object.prototype.toString
    ) {
      document.toString = serialize;
    }
  } catch (error) {
    // Documents are normally extensible. If one is not, the native
    // serialization is still safe to call, so there is nothing to do here.
  }

  return { document: document };
}
