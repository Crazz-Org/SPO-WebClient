import { interceptMailLinks } from './mail-link-interceptor';

function mountFrame(): { iframe: HTMLIFrameElement; doc: Document } {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`
    <body>
      <a id="select" href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41">
        <span id="inner">Demolished Building</span>
      </a>
      <a id="foreign" href="http://example.com">elsewhere</a>
      <a id="bad" href="javascript:alert(1)">js</a>
      <b id="text">not a link</b>
    </body>
  `);
  doc.close();
  return { iframe, doc };
}

function click(doc: Document, id: string): MouseEvent {
  const el = doc.getElementById(id)!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe('interceptMailLinks', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('translates a local.asp SELECT anchor into onSelect(x, y) and prevents navigation', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    interceptMailLinks(doc, onSelect);

    const event = click(doc, 'select');

    expect(onSelect).toHaveBeenCalledWith(220, 41);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a click inside the anchor (closest) still resolves to the SELECT link', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    interceptMailLinks(doc, onSelect);

    const event = click(doc, 'inner');

    expect(onSelect).toHaveBeenCalledWith(220, 41);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a foreign anchor is prevented but does not call onSelect', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    interceptMailLinks(doc, onSelect);

    const event = click(doc, 'foreign');

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('a javascript: href is prevented but does not call onSelect', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    interceptMailLinks(doc, onSelect);

    const event = click(doc, 'bad');

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('a click on non-anchor text is neither prevented nor forwarded', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    interceptMailLinks(doc, onSelect);

    const event = click(doc, 'text');

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('after detaching, a click is no longer intercepted', () => {
    const { doc } = mountFrame();
    const onSelect = jest.fn();
    const detach = interceptMailLinks(doc, onSelect);
    detach();

    const event = click(doc, 'select');

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
