-- Company items given to staff (laptop, mobile phone, SIM, lab coat, slippers, ...).
-- The type list can be added to from the screen. Each "given" row is its own record; the company comes from the person (so "Change company" moves the items with them).

CREATE TABLE staff_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_item_types_name_idx ON staff_item_types (lower(name));

INSERT INTO staff_item_types (name, sort_order) VALUES
  ('Laptop', 10), ('Mobile phone', 20), ('SIM card', 30), ('Lab coat', 40), ('Slippers', 50),
  ('Safety shoes', 60), ('Uniform', 70), ('ID card', 80), ('Locker key', 90);

CREATE TABLE staff_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  item_type_id uuid NOT NULL REFERENCES staff_item_types(id),
  details text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  issued_on date NOT NULL,
  status text NOT NULL DEFAULT 'with_staff' CHECK (status IN ('with_staff', 'returned', 'lost', 'damaged')),
  status_on date,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_items_employee_idx ON staff_items (employee_id, status);
CREATE INDEX staff_items_type_idx ON staff_items (item_type_id, status);

CREATE TABLE staff_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES staff_items(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('given', 'returned', 'lost', 'damaged', 'reopened', 'edited')),
  occurred_on date NOT NULL,
  note text,
  performed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_item_events_item_idx ON staff_item_events (item_id, created_at DESC);

-- Stock: what the company bought / received (added) and what left stock for good, e.g. sold or scrapped (removed), per company and item type.
-- In stock = added - removed - (items with staff) - (lost) - (damaged). Returned items are back in stock.
CREATE TABLE staff_item_stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  item_type_id uuid NOT NULL REFERENCES staff_item_types(id),
  entry_type text NOT NULL CHECK (entry_type IN ('added', 'removed')),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  entry_on date NOT NULL,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_item_stock_idx ON staff_item_stock_entries (business_head_id, item_type_id);
