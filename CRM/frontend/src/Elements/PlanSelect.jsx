import { Combobox } from '../Pages/Project/Booking/BookingCreateModal.jsx';

// Reuses the app-wide custom <Combobox> (same one as New promo code / Booking):
// portal'd dropdown (never clipped by the modal), dark theme, DynamicBlock
// indicator. Keys match backend plan slugs — a paid pick routes the new org
// to the inline Paddle checkout.
const PLAN_OPTIONS = [
  { value: 'free',     label: 'Free — $0/mo'   },
  { value: 'standard', label: 'Standard — $10/mo'  },
  { value: 'plus',     label: 'Plus — $25/mo'  },
  { value: 'pro',      label: 'Pro — $30/mo'   },
  { value: 'max',      label: 'Max — $599/mo' },
];

export default function PlanSelect({ value, onChange }) {
  return (
    <Combobox
      value={value}
      options={PLAN_OPTIONS}
      onChange={onChange}
      placeholder="Select a plan"
    />
  );
}
