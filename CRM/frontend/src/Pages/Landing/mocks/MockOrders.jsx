// Static, faithful mock of the CRM Orders page (light theme only).
// Mirrors Pages/Project/Orders.jsx; reuses the .mk-ov-badge status pills.

import { MagnifyingGlass, ShoppingCart } from '@phosphor-icons/react';

const FILTERS = ['All', 'New', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'];

const ORDERS = [
  { no: '#1042', name: 'Aigerim Nurlanovna', email: 'aigerim.n@gmail.com', items: '3 items', amount: '$128.40', date: 'Jul 14', st: 'delivered', stLabel: 'Delivered' },
  { no: '#1041', name: 'Daniyar Bekov',       email: 'd.bekov@mail.ru',     items: '1 item',  amount: '$54.00',  date: 'Jul 14', st: 'shipped',   stLabel: 'Shipped' },
  { no: '#1040', name: 'Marina S.', guest: true, email: 'marina.s@outlook.com', items: '2 items', amount: '$89.90', date: 'Jul 13', st: 'new', stLabel: 'New' },
  { no: '#1039', name: 'Timur Ali',           email: 'timur.ali@gmail.com', items: '5 items', amount: '$312.75', date: 'Jul 13', st: 'confirmed', stLabel: 'Confirmed' },
  { no: '#1038', name: 'Saule Kimova',        email: 'saule.k@gmail.com',   items: '1 item',  amount: '$19.99',  date: 'Jul 12', st: 'cancelled', stLabel: 'Cancelled' },
  { no: '#1037', name: 'Erlan Zhaksybek',     email: 'erlan.zh@yandex.kz',  items: '4 items', amount: '$176.20', date: 'Jul 12', st: 'refunded',  stLabel: 'Refunded' },
  { no: '#1036', name: 'Anna Petrova',        email: 'anna.p@gmail.com',    items: '2 items', amount: '$64.50',  date: 'Jul 11', st: 'delivered', stLabel: 'Delivered' },
  { no: '#1035', name: 'Dias Mukhamedin',     email: 'dias.m@gmail.com',    items: '3 items', amount: '$142.00', date: 'Jul 11', st: 'confirmed', stLabel: 'Confirmed' },
  { no: '#1034', name: 'Zhanna K.', guest: true, email: 'zhanna.k@mail.ru', items: '1 item',  amount: '$27.50',  date: 'Jul 10', st: 'new',       stLabel: 'New' },
  { no: '#1033', name: 'Olzhas Serik',        email: 'olzhas.s@gmail.com',  items: '2 items', amount: '$78.30',  date: 'Jul 10', st: 'delivered', stLabel: 'Delivered' },
];

export default function MockOrders() {
  return (
    <div className="mk-or">
      <div className="mk-or-head">
        <h3 className="mk-or-title">Orders</h3>
        <div className="mk-or-tools">
          <span className="mk-or-search"><MagnifyingGlass weight="bold" /> Search orders…</span>
          <span className="mk-or-new"><ShoppingCart weight="bold" /> New sale</span>
        </div>
      </div>

      <div className="mk-or-filters">
        {FILTERS.map((f, i) => (
          <span key={f} className={`mk-or-fpill${i === 0 ? ' mk-or-fpill--on' : ''}`}>
            {f}{f === 'New' && <em className="mk-or-fbadge">1</em>}
          </span>
        ))}
      </div>

      <div className="mk-or-list">
        <div className="mk-or-lhead">
          <span>Customer</span><span>Items</span><span>Amount</span><span>Date</span><span>Status</span>
        </div>
        {ORDERS.map((o) => (
          <div key={o.no} className="mk-or-row">
            <span className="mk-or-cust">
              <span className="mk-or-cname">{o.name}{o.guest && <em className="mk-or-guest">Guest</em>}</span>
              <span className="mk-or-csub"><b>{o.no}</b> · {o.email}</span>
            </span>
            <span className="mk-or-cell">{o.items}</span>
            <span className="mk-or-cell mk-or-amt">{o.amount}</span>
            <span className="mk-or-cell">{o.date}</span>
            <span className="mk-or-badge-cell">
              <span className={`mk-ov-badge mk-ov-badge--${o.st}`}>{o.stLabel}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
