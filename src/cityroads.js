import * as THREE from 'three';
import { makeSign } from './signs.js';

// Standalone road furniture for the city worlds (Monaco / Dubai / Singapore), which don't have
// Kent's full road network. Real UK traffic signs (from signs.js) and working traffic lights that
// cycle green -> amber -> red -> red+amber. Kent and Whitmore keep their own net-driven system.

const LAMP = { red: 0xff2a1a, amber: 0xffb21a, green: 0x2bff7a, off: 0x141414 };
const ASPECT = { green: [0, 0, 1], amber: [0, 1, 0], red: [1, 0, 0], redamber: [1, 1, 0] };

const poleMat = new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.7, roughness: 0.5 });
const caseMat = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.6, metalness: 0.2 });

/** one traffic-light head on a pole; the lamps face the group's -z, so rotate yaw toward oncoming traffic */
export function trafficLight(x, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = yaw;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 3.5, 10), poleMat);
  pole.position.y = 1.75; pole.castShadow = true; g.add(pole);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.02, 0.28), caseMat);
  housing.position.set(0, 3.25, 0); housing.castShadow = true; g.add(housing);
  const lamps = [];
  [0, 1, 2].forEach((i) => {
    const m = new THREE.MeshBasicMaterial({ color: LAMP.off, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), m);
    lamp.position.set(0, 3.25 + 0.3 - i * 0.3, -0.145);
    lamp.rotation.y = Math.PI; // face -z
    g.add(lamp);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.08, 12, 1, true, 0, Math.PI), caseMat);
    hood.rotation.set(Math.PI / 2, 0, 0);
    hood.position.set(0, 3.25 + 0.3 - i * 0.3 + 0.06, -0.15);
    g.add(hood);
    lamps.push(m);
  });
  const apply = (s) => {
    const a = ASPECT[s] || [0, 0, 0];
    lamps[0].color.setHex(a[0] ? LAMP.red : LAMP.off);
    lamps[1].color.setHex(a[1] ? LAMP.amber : LAMP.off);
    lamps[2].color.setHex(a[2] ? LAMP.green : LAMP.off);
  };
  let state = 'red'; apply('red');
  return { group: g, x, z, yaw, get state() { return state; }, setState(s) { if (ASPECT[s] && s !== state) { state = s; apply(s); } } };
}

// a 24s signal cycle; opposing approaches at a junction take offset 12 so one is green while the other is red
const CYCLE = 24, GREEN = 11, AMBER = 3, RED = 8;
function stateAt(t) {
  t = ((t % CYCLE) + CYCLE) % CYCLE;
  if (t < GREEN) return 'green';
  if (t < GREEN + AMBER) return 'amber';
  if (t < GREEN + AMBER + RED - 2) return 'red';
  return 'redamber';
}

/** place working traffic lights; specs: [{x,z,yaw,offset?}] */
export function cityLights(scene, specs) {
  const heads = specs.map((s) => {
    const h = trafficLight(s.x, s.z, s.yaw);
    h.offset = s.offset ?? 0;
    scene.add(h.group);
    return h;
  });
  return { heads, tick(t) { for (const h of heads) h.setState(stateAt(t + h.offset)); } };
}

/** place real UK signs; list: [{id,x,z,yaw,band?,plate?}] */
export function placeSigns(scene, list) {
  for (const s of list) {
    try {
      const sign = makeSign({ id: s.id, band: s.band || '30', plate: s.plate });
      sign.position.set(s.x, 0, s.z);
      sign.rotation.y = s.yaw || 0;
      scene.add(sign);
    } catch { /* skip an id that can't be drawn rather than break the world */ }
  }
}
