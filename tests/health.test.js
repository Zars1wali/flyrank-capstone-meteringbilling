const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');

describe('Health Check API Tests', () => {
  test('GET /health returns 200 OK and connected status', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.database, 'connected');
  });

  test('GET / returns 200 OK with service info', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Usage Metering & Billing Engine');
  });
});
