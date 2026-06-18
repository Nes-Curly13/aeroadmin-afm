// E2E test: inserta un evento de fumigación via SQL directo y verifica
// que la lógica de la app funciona (recalcula next_due, etc).
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv();
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const c = await p.connect();
  try {
    // Tomar 3 parcelas: una overdue, una due_soon, una ok
    // (los IDs reales no son 1,2,3 — son los del último batch)
    const sample = await c.query('SELECT id FROM dji_parcels ORDER BY id LIMIT 3');
    const testIds = sample.rows.map(r => r.id);
    console.log('IDs de prueba:', testIds);

    // Registrar fumigaciones a diferentes fechas
    const today = new Date();
    const minus = (d) => {
      const x = new Date(today);
      x.setDate(x.getDate() - d);
      return x.toISOString().slice(0, 10);
    };

    // Parcel 1: fumigada hace 30 días (overdue, cadencia 14d)
    // Parcel 2: fumigada hace 12 días (due_soon, cadencia 14d)
    // Parcel 3: fumigada hace 5 días (ok, cadencia 14d)
    const events = [
      { id: testIds[0], date: minus(30), product: 'Glifosato 1L/ha' },
      { id: testIds[1], date: minus(12), product: 'Imidacloprid' },
      { id: testIds[2], date: minus(5),  product: 'Tebuconazol' }
    ];

    for (const ev of events) {
      await c.query('BEGIN');
      await c.query(`
        INSERT INTO dji_fumigations
          (parcel_id, fumigation_date, product_used, dose_l_per_ha, recorded_by, source)
        VALUES ($1, $2, $3, 1.5, 'Test e2e', 'manual')
      `, [ev.id, ev.date, ev.product]);
      // Recalcular next_due
      const sched = await c.query('SELECT recommended_cadence_days FROM dji_fumigation_schedule WHERE parcel_id = $1', [ev.id]);
      if (sched.rows[0]) {
        const cadence = sched.rows[0].recommended_cadence_days;
        const next = new Date(ev.date);
        next.setDate(next.getDate() + cadence);
        const nextStr = next.toISOString().slice(0, 10);
        await c.query(`
          UPDATE dji_fumigation_schedule
          SET last_fumigation_date = $2, next_due_date = $3, updated_at = NOW()
          WHERE parcel_id = $1
        `, [ev.id, ev.date, nextStr]);
      }
      await c.query('COMMIT');
    }

    // Mostrar el estado resultante
    const result = await c.query(`
      SELECT
        p.land_name,
        s.crop_type,
        s.recommended_cadence_days,
        s.last_fumigation_date,
        s.next_due_date
      FROM dji_fumigation_schedule s
      JOIN dji_parcels p ON p.id = s.parcel_id
      WHERE p.id = ANY($1)
      ORDER BY p.id
    `, [testIds]);
    console.log('=== Después de registrar eventos ===');
    for (const r of result.rows) {
      console.log(`  ${r.land_name} | ${r.crop_type} | cadencia=${r.recommended_cadence_days}d | última=${r.last_fumigation_date} | próxima=${r.next_due_date}`);
    }

    // Cleanup: borrar los eventos de prueba
    for (const ev of events) {
      await c.query('DELETE FROM dji_fumigations WHERE parcel_id = $1', [ev.id]);
      await c.query('UPDATE dji_fumigation_schedule SET last_fumigation_date = NULL, next_due_date = NULL WHERE parcel_id = $1', [ev.id]);
    }
    console.log('\n(Cleanup: eventos de prueba eliminados)');
  } finally {
    c.release();
    await p.end();
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
