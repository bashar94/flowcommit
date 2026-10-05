/**
 * Opens the picture on its own page and asks the browser to print it, where "Save as PDF" makes
 * a PDF. The page is opened right away (browsers only allow pop-ups straight after a click) and
 * filled in once the picture is ready.
 */
export function printPicture(title: string, picture: Promise<string>) {
  const page = window.open("", "_blank");
  if (!page) throw new Error("Your browser blocked the print window. Allow pop-ups for FlowCommit and try again.");
  page.document.title = title;
  page.document.body.textContent = "Preparing your flowchart…";
  picture.then(
    (src) => {
      const doc = page.document;
      doc.body.textContent = "";
      const style = doc.createElement("style");
      style.textContent =
        "@page{margin:12mm}body{margin:0;font:14px system-ui,sans-serif}h1{font-size:18px;margin:0 0 8px}img{width:100%;height:auto}";
      const heading = doc.createElement("h1");
      heading.textContent = title;
      const img = doc.createElement("img");
      img.src = src;
      img.alt = title;
      img.onload = () => page.print();
      doc.head.append(style);
      doc.body.append(heading, img);
    },
    (err: Error) => {
      page.document.body.textContent = `FlowCommit couldn't make the picture: ${err.message}`;
    },
  );
}
