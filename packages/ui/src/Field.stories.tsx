import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, Input, Select, Textarea } from './Field';

/** Board D02 / D02c: connection form, blank and with validation errors. */
const meta = { title: 'UI/Field', component: Field } satisfies Meta<typeof Field>;
export default meta;
type S = StoryObj<typeof meta>;

const wrap = 'flex w-[560px] flex-col gap-4';

export const Blank: S = {
  args: { label: '', children: null },
  render: () => (
    <div className={wrap}>
      <Field label="Name" required>
        <Input placeholder="payments-prod" />
      </Field>
      <Field label="JobManager REST URL" help="Usually port 8081.">
        <Input mono placeholder="https://flink.example.com:8081" />
      </Field>
      <Field label="Login method">
        <Select defaultValue="none">
          <option value="none">None</option>
          <option value="basic">Basic</option>
          <option value="bearer">Bearer token</option>
          <option value="mtls">mTLS</option>
        </Select>
      </Field>
      <Field label="Refresh every (seconds)">
        <Input type="number" defaultValue={5} min={1} />
      </Field>
      <Field label="Client certificate (PEM)">
        <Input type="file" accept=".pem,.crt" />
      </Field>
      <Field label="Tags">
        <Input list="tags" placeholder="prod, staging or dev" />
      </Field>
      <datalist id="tags">
        <option value="prod" />
        <option value="staging" />
        <option value="dev" />
      </datalist>
      <Field label="Notes">
        <Textarea rows={3} />
      </Field>
    </div>
  ),
};

export const Invalid: S = {
  args: { label: '', children: null },
  render: () => (
    <div className={wrap}>
      <Field label="Name" required error='A connection called "payments-prod" already exists.'>
        <Input defaultValue="payments-prod" />
      </Field>
      <Field
        label="JobManager REST URL"
        required
        error="Enter a full address like https://flink.example.com:8081."
      >
        <Input mono defaultValue="10.0.4.12:8081" />
      </Field>
      <Field label="Token" required error="Token is required.">
        <Input type="password" />
      </Field>
    </div>
  ),
};

export const Disabled: S = {
  args: { label: '', children: null },
  render: () => (
    <div className={wrap}>
      <Field label="Name" help="Read-only connections can not be renamed here.">
        <Input defaultValue="payments-prod" disabled />
      </Field>
    </div>
  ),
};
