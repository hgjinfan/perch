import { createServer } from 'node:http';

// Local protocol doubles, not real Home Assistant / Proxmox / Prometheus / Jellyfin installations.
export const presetTestEnv = {
  WIDGET_HOME_ASSISTANT_TOKEN: 'ha-test-secret',
  WIDGET_PROXMOX_TOKEN: 'pve-test-secret',
  WIDGET_PROMETHEUS_TOKEN: 'prom-test-secret',
};
const definitions = {
  'home-assistant-sensor': {
    path: '/proxy/api/states/sensor.temperature',
    authorization: 'Bearer ha-test-secret',
    sample: {
      entity_id: 'sensor.temperature',
      state: '23.5',
      attributes: { unit_of_measurement: '°C', private_note: 'never-public' },
    },
    bad: { state: 'unavailable' },
    values: { entity: 'sensor.temperature', unit: '°C' },
  },
  'proxmox-node': {
    path: '/proxy/api2/json/nodes/pve1/status',
    authorization: 'PVEAPIToken=monitor@pve!perch=pve-test-secret',
    sample: {
      data: {
        cpu: 0.125,
        memory: { used: 2147483648 },
        rootfs: { used: 3221225472 },
        private_note: 'never-public',
      },
    },
    bad: { data: { cpu: 0.125 } },
    values: { user: 'monitor@pve', tokenId: 'perch', node: 'pve1' },
  },
  prometheus: {
    path: '/proxy/api/v1/query',
    authorization: 'Bearer prom-test-secret',
    sample: {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [{ metric: { instance: 'never-public' }, value: [1792700000, '7'] }],
      },
    },
    bad: { status: 'success', data: { resultType: 'vector', result: [] } },
    values: { query: 'sum(up)', unit: '个' },
  },
  'jellyfin-version': {
    path: '/proxy/System/Info/Public',
    authorization: undefined,
    sample: { Version: '10.11.0', ServerName: 'never-public', Id: 'never-public' },
    bad: { ServerName: 'never-public' },
    values: {},
  },
};
export async function startPresetServices() {
  const services = {};
  try {
    for (const [key, definition] of Object.entries(definitions)) {
      const service = { mode: 'ok', requests: [] };
      const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        service.requests.push({
          path: url.pathname,
          query: url.searchParams.get('query'),
          authorization: request.headers.authorization,
        });
        const json = (status, value) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(value));
        };
        if (request.method !== 'GET') return json(405, { error: 'GET required' });
        if (url.pathname !== definition.path) return json(404, { error: 'Unknown endpoint' });
        if (request.headers.authorization !== definition.authorization)
          return json(401, { error: 'Wrong test credentials' });
        if (key === 'prometheus' && url.searchParams.get('query') !== 'sum(up)')
          return json(400, { error: 'Unexpected query' });
        if (service.mode === 'bad-json') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end('{invalid');
          return;
        }
        if (service.mode === 'redirect') {
          response.writeHead(302, { Location: '/unexpected' });
          response.end();
          return;
        }
        if (service.mode === 'unavailable') return json(503, { error: 'Test unavailable' });
        return json(200, service.mode === 'bad-shape' ? definition.bad : definition.sample);
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      service.base = `http://127.0.0.1:${server.address().port}/proxy`;
      service.values = { ...definition.values, base: service.base };
      service.close = () => new Promise((resolve) => server.close(resolve));
      services[key] = service;
    }
    return {
      services,
      env: { ...presetTestEnv },
      close: () => Promise.all(Object.values(services).map((service) => service.close())),
    };
  } catch (error) {
    await Promise.all(Object.values(services).map((service) => service.close()));
    throw error;
  }
}
