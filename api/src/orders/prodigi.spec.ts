import {
  extractProdigiShipment,
  mapProdigiStageToOrderStatus,
  prodigiAutoSubmitEnabled,
  prodigiBaseUrl,
  prodigiShippingMethod,
} from './prodigi';

describe('prodigi helpers', () => {
  const envKeys = [
    'PRODIGI_API_KEY',
    'PRODIGI_AUTO_SUBMIT',
    'PRODIGI_ENV',
    'PRODIGI_API_BASE',
    'PRODIGI_SHIPPING_METHOD',
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) prev[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('defaults to sandbox base URL', () => {
    delete process.env.PRODIGI_ENV;
    delete process.env.PRODIGI_API_BASE;
    expect(prodigiBaseUrl()).toBe('https://api.sandbox.prodigi.com/v4.0');
  });

  it('uses live base when PRODIGI_ENV=live', () => {
    process.env.PRODIGI_ENV = 'live';
    expect(prodigiBaseUrl()).toBe('https://api.prodigi.com/v4.0');
  });

  it('auto-submit follows env when key present', () => {
    process.env.PRODIGI_API_KEY = 'test-key';
    delete process.env.PRODIGI_AUTO_SUBMIT;
    expect(prodigiAutoSubmitEnabled()).toBe(true);
    process.env.PRODIGI_AUTO_SUBMIT = 'false';
    expect(prodigiAutoSubmitEnabled()).toBe(false);
  });

  it('parses Budget shipping method', () => {
    process.env.PRODIGI_SHIPPING_METHOD = 'standard';
    expect(prodigiShippingMethod()).toBe('Standard');
  });

  it('maps Prodigi stages to order statuses', () => {
    expect(mapProdigiStageToOrderStatus('InProgress')).toBe('PRINTING');
    expect(mapProdigiStageToOrderStatus('Complete')).toBe('SHIPPED');
    expect(mapProdigiStageToOrderStatus('Cancelled')).toBe('CANCELLED');
    expect(mapProdigiStageToOrderStatus('Draft')).toBeNull();
  });

  it('extracts tracking from shipments', () => {
    const info = extractProdigiShipment({
      shipments: [
        {
          status: 'Shipped',
          tracking: {
            number: '1Z999',
            url: 'https://track.example/1Z999',
          },
          carrier: { name: 'UPS' },
        },
      ],
    });
    expect(info.trackingNumber).toBe('1Z999');
    expect(info.carrier).toBe('UPS');
    expect(info.trackingUrl).toContain('1Z999');
  });
});
