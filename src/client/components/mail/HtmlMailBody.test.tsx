import { fireEvent } from '@testing-library/react';
import { HtmlMailBody } from './HtmlMailBody';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';

const ALERT_ANCHOR = 'http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41';
const META_REFRESH_BODY = [
  '<HEAD>',
  '</HEAD>',
  '<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=http://158.69.153.134/Five//0/MsgZoned.asp">',
];

describe('HtmlMailBody', () => {
  it('a META REFRESH body with a gateway-fetched htmlBody renders same-origin srcdoc, and clicking a translated link navigates', () => {
    const onNavigateToBuilding = jest.fn();
    const { container } = renderWithProviders(
      <HtmlMailBody body={META_REFRESH_BODY} htmlBody={`<a href="${ALERT_ANCHOR}">Demolished Building</a>`} />,
      { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) },
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBeNull();
    expect(iframe.srcdoc).toBe(`<a href="${ALERT_ANCHOR}">Demolished Building</a>`);
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');

    // jsdom does not render `srcdoc` into contentDocument — write it in ourselves.
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<a href="${ALERT_ANCHOR}">Demolished Building</a>`);
    doc.close();
    fireEvent.load(iframe);

    const anchor = doc.querySelector('a')!;
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(220, 41);
  });

  it('a META REFRESH body with no htmlBody falls back to the cross-origin src frame', () => {
    const { container } = renderWithProviders(<HtmlMailBody body={META_REFRESH_BODY} />);

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('http://158.69.153.134/Five//0/MsgZoned.asp');
    expect(iframe.srcdoc).toBe('');
  });

  it('a static HTML body renders as srcdoc, and a link click is inert', () => {
    const onNavigateToBuilding = jest.fn();
    const staticBody = ['<HTML><BODY><a href="http://example.com">x</a></BODY></HTML>'];
    const { container } = renderWithProviders(<HtmlMailBody body={staticBody} />, {
      clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }),
    });

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.srcdoc).toBe(staticBody.join('\n'));

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(staticBody[0]);
    doc.close();
    fireEvent.load(iframe);

    const anchor = doc.querySelector('a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(onNavigateToBuilding).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
