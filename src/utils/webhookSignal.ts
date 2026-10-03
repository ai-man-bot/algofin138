export type WebhookSignal = {
  asset: 'option' | 'equity'; action: 'open' | 'close_all' | 'target_reached' | 'add' | 'incomplete_close';
  underlying: string; strike?: number; option_type?: 'call' | 'put';
  month?: number; day?: number; year?: number;
  reference_price?: string; target_price?: string; stop_price?: string; target_number?: number;
  close_reason?: 'signal' | 'stop' | 'trailing_stop'; gain_percent?: number;
};

export function parseWebhookSignal(message: unknown): WebhookSignal {
  if (typeof message !== 'string' || !message.trim() || message.length > 16384) throw new Error('Expected a nonempty trading message');
  const text = message.trim().replace(/\s+/g, ' ')
    .replace(/\b(BTO)(?=Buy\b)/ig, '$1 ').replace(/\b(STC)(?=Close\b|Reached\b)/ig, '$1 ')
    .replace(/\b(DCA)(?=Add\b)/ig, '$1 ');
  const header = text.match(/^([a-z]{1,6})(?:\s*:?\s+(\d+(?:\.\d{1,3})?)\s*([cp])\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?)\s*:\s*(.+)$/i)
    ?? text.match(/^([a-z]{1,6})\s*:\s*(.+)$/i);
  if (!header) throw new Error('Expected a ticker or option contract followed by a trading instruction');
  const option = header.length > 3;
  const signal: WebhookSignal = { asset: option ? 'option' : 'equity', underlying: header[1].toUpperCase(), action: 'open' };
  if (option) {
    Object.assign(signal, { strike: Number(header[2]), option_type: header[3].toUpperCase() === 'C' ? 'call' : 'put',
      month: Number(header[4]), day: Number(header[5]), year: header[6] ? (header[6].length === 2 ? 2000 + Number(header[6]) : Number(header[6])) : undefined });
    const date = new Date(Date.UTC(signal.year ?? 2000, signal.month! - 1, signal.day!));
    if (signal.strike! <= 0 || signal.strike! >= 100000 || date.getUTCMonth() + 1 !== signal.month || date.getUTCDate() !== signal.day) throw new Error('Invalid expiration date or strike');
  }
  const instruction = option ? header[7] : header[2];
  const price = (value: string) => { if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error('Expected a positive price'); return Number(value).toFixed(2); };
  const p = '\\$?(\\d+(?:\\.\\d{1,2})?)';
  let match = instruction.match(new RegExp(`^BTO(?: Buy to open)? at ${p} with (?:the )?first target (?:above |at )?${p}[.!]?$`, 'i'));
  if (match) {
    signal.reference_price = price(match[1]); signal.target_price = price(match[2]);
    if (Number(signal.target_price) <= Number(signal.reference_price)) throw new Error('Strike and entry must be positive; first target must exceed entry');
    return signal;
  }
  match = instruction.match(new RegExp(`^STC Close the trade(?: as it hit (trailing stop|stop))? at ${p}[.!]?$`, 'i'));
  if (match) return { ...signal, action: 'close_all', close_reason: match[1]?.toLowerCase() === 'trailing stop' ? 'trailing_stop' : match[1] ? 'stop' : 'signal', reference_price: price(match[2]) };
  match = instruction.match(new RegExp(`^STC Reached Target ${p} and that's (\\d+(?:\\.\\d+)?)%! Lock some in and wait for next target\\. Raise the stops to ${p}[.!]?$`, 'i'));
  if (match) return { ...signal, action: 'target_reached', reference_price: price(match[1]), gain_percent: Number(match[2]), stop_price: price(match[3]) };
  match = instruction.match(new RegExp(`^STC Reached SellTarget([1-9]\\d*) @${p}\\. Take profits and ride the runners\\. Gain: (\\d+(?:\\.\\d+)?)%[.!]?$`, 'i'));
  if (match) return { ...signal, action: 'target_reached', target_number: Number(match[1]), reference_price: price(match[2]), gain_percent: Number(match[3]) };
  match = instruction.match(new RegExp(`^DCA Add more at ${p} for dollar cost averaging[.!]?$`, 'i'));
  if (match) return { ...signal, action: 'add', reference_price: price(match[1]) };
  if (/^STC$/i.test(instruction)) return { ...signal, action: 'incomplete_close' };
  throw new Error('Expected a supported BTO entry, STC close/target, or DCA instruction');
}

export function signalExecutionGap(signal: WebhookSignal) {
  if (signal.action === 'incomplete_close') return 'Needs review: STC does not specify a closing instruction';
  if (signal.asset === 'equity') return 'Needs configuration: equity sizing and exit policies';
  if (signal.action === 'add') return 'Needs configuration: DCA quantity, exposure limits, and target recalculation';
  return null;
}
