type BrokerRow = {
  id?: string;
  broker_type?: string;
  brokerType?: string;
  account_id?: string;
  accountId?: string;
  metadata?: {
    account?: {
      account_number?: string;
    };
  };
  updated_at?: string;
  created_at?: string;
};

type CredentialRow = {
  broker_account_id?: string;
  api_key?: string;
  api_secret?: string;
};

function getBrokerType(broker: BrokerRow) {
  return String(broker?.broker_type ?? broker?.brokerType ?? '').toLowerCase();
}

function getAccountNumber(broker: BrokerRow) {
  return String(
    broker?.account_id ??
      broker?.accountId ??
      broker?.metadata?.account?.account_number ??
      '',
  ).trim();
}

function getBrokerTimestamp(broker: BrokerRow) {
  return Date.parse(
    String(broker?.updated_at ?? broker?.created_at ?? '1970-01-01T00:00:00.000Z'),
  ) || 0;
}

function getCredentialSignature(credential?: CredentialRow | null) {
  const apiKey = String(credential?.api_key ?? '').trim();
  const apiSecret = String(credential?.api_secret ?? '').trim();

  if (!apiKey || !apiSecret) {
    return null;
  }

  return `${apiKey}:${apiSecret}`;
}

export function dedupeBrokerAccounts(
  brokers: BrokerRow[] = [],
  credentials: CredentialRow[] = [],
) {
  const credentialByBrokerId = new Map(
    credentials.map((credential) => [String(credential?.broker_account_id ?? ''), credential]),
  );
  const seen = new Set<string>();

  return [...brokers]
    .sort((left, right) => getBrokerTimestamp(right) - getBrokerTimestamp(left))
    .filter((broker) => {
      const brokerId = String(broker?.id ?? '');
      const brokerType = getBrokerType(broker);
      const accountNumber = getAccountNumber(broker);
      const credentialSignature = getCredentialSignature(credentialByBrokerId.get(brokerId));
      const candidateKeys = [
        brokerType && accountNumber ? `${brokerType}:account:${accountNumber}` : null,
        brokerType && credentialSignature ? `${brokerType}:credential:${credentialSignature}` : null,
        brokerId ? `row:${brokerId}` : null,
      ].filter(Boolean) as string[];

      if (candidateKeys.some((key) => seen.has(key))) {
        return false;
      }

      candidateKeys.forEach((key) => seen.add(key));
      return true;
    });
}

export function findConflictingBrokerAccountIds(input: {
  brokers?: BrokerRow[];
  credentials?: CredentialRow[];
  canonicalBrokerAccountId: string;
  brokerType: string;
  accountNumber?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
}) {
  const {
    brokers = [],
    credentials = [],
    canonicalBrokerAccountId,
    brokerType,
    accountNumber,
    apiKey,
    apiSecret,
  } = input;
  const normalizedBrokerType = String(brokerType || '').toLowerCase();
  const normalizedAccountNumber = String(accountNumber ?? '').trim();
  const normalizedApiKey = String(apiKey ?? '').trim();
  const normalizedApiSecret = String(apiSecret ?? '').trim();
  const conflictingIds = new Set<string>();

  for (const broker of brokers) {
    const brokerId = String(broker?.id ?? '').trim();
    if (!brokerId || brokerId === canonicalBrokerAccountId) continue;
    if (getBrokerType(broker) !== normalizedBrokerType) continue;

    const brokerAccountNumber = getAccountNumber(broker);
    if (normalizedAccountNumber && brokerAccountNumber === normalizedAccountNumber) {
      conflictingIds.add(brokerId);
    }
  }

  for (const credential of credentials) {
    const brokerId = String(credential?.broker_account_id ?? '').trim();
    if (!brokerId || brokerId === canonicalBrokerAccountId) continue;
    const credentialApiKey = String(credential?.api_key ?? '').trim();
    const credentialApiSecret = String(credential?.api_secret ?? '').trim();

    if (
      normalizedApiKey &&
      normalizedApiSecret &&
      credentialApiKey === normalizedApiKey &&
      credentialApiSecret === normalizedApiSecret
    ) {
      conflictingIds.add(brokerId);
    }
  }

  return Array.from(conflictingIds);
}
