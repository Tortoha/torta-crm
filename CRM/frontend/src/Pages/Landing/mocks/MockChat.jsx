// Static, faithful mock of the CRM "Chat with customers" inbox (light theme).
// Two panels: conversation list + message thread. Mirrors Pages/Project/Chat.

import {
  MagnifyingGlass, CaretDown, PaperPlaneRight,
  TelegramLogo, WhatsappLogo, InstagramLogo, Globe,
} from '@phosphor-icons/react';

const CONVS = [
  { id: 'tg_8842019',  Icon: TelegramLogo,  preview: 'Do you have this in size M?',    time: '09:41', unread: 2, current: true },
  { id: 'wa_+7701447', Icon: WhatsappLogo,  preview: 'Спасибо, заказ получил!',        time: '08:12', unread: 0 },
  { id: 'web_a1f9c3',  Icon: Globe,         preview: 'Hi, when will you restock?',      time: 'Mon',   unread: 1 },
  { id: 'ig_stylehub', Icon: InstagramLogo, preview: 'love the new drop',               time: 'Fri',   unread: 0 },
  { id: 'tg_5521904',  Icon: TelegramLogo,  preview: 'Can you ship to Astana?',         time: 'Thu',   unread: 0 },
];

const MSGS = [
  { out: false, text: 'Hi! Do you have the linen shirt in size M?',                   time: '09:38' },
  { out: true,  text: 'Hey Alex — yes, M is in stock. Want me to reserve one?',       time: '09:40' },
  { out: false, text: 'Yes please, and can I pick it up in-store?',                   time: '09:41' },
  { out: true,  text: 'Reserved for pickup at our Almaty store till Friday.',         time: '09:41' },
];

export default function MockChat() {
  return (
    <div className="mk-ch">
      <aside className="mk-ch-aside">
        <div className="mk-ch-search"><MagnifyingGlass weight="bold" /> Search conversations…</div>
        <div className="mk-ch-folder">
          <div className="mk-ch-folder-head"><CaretDown weight="bold" /> ACTIVE <em>5</em></div>
          <div className="mk-ch-convs">
            {CONVS.map((c) => (
              <div key={c.id} className={`mk-ch-conv${c.current ? ' mk-ch-conv--on' : ''}`}>
                <span className="mk-ch-avatar"><c.Icon weight="fill" /></span>
                <div className="mk-ch-conv-txt">
                  <div className="mk-ch-conv-top">
                    <span className="mk-ch-uid">{c.id}</span>
                    <span className="mk-ch-time">{c.time}</span>
                  </div>
                  <div className="mk-ch-conv-bot">
                    <span className="mk-ch-preview">{c.preview}</span>
                    {c.unread > 0 && <span className="mk-ch-unread">{c.unread}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="mk-ch-thread">
        <div className="mk-ch-thread-head">
          <span className="mk-ch-avatar"><TelegramLogo weight="fill" /></span>
          <div className="mk-ch-thread-id"><b>tg_8842019</b><span>via Telegram</span></div>
          <span className="mk-ch-close">Close chat</span>
        </div>
        <div className="mk-ch-scroll">
          {MSGS.map((m, i) => (
            <div key={i} className={`mk-ch-msg${m.out ? ' mk-ch-msg--out' : ''}`}>
              <div className="mk-ch-bubble">{m.text}<span className="mk-ch-mtime">{m.time}</span></div>
            </div>
          ))}
        </div>
        <div className="mk-ch-composer">
          <span className="mk-ch-input">Type a message…</span>
          <span className="mk-ch-send"><PaperPlaneRight weight="fill" /></span>
        </div>
      </div>
    </div>
  );
}
