// Minimal Vec3 math. Kept dependency-free so this package has zero runtime deps and can be
// imported unmodified by both the browser client and the Node server.
//
// Y is up (matches Three.js). Note this differs from Source's Z-up convention, so where
// MOVEMENT_SPEC.md refers to a surface normal's "up" component, that is `normal.y` here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = {
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),

  up: (): Vec3 => ({ x: 0, y: 1, z: 0 }),

  of: (x: number, y: number, z: number): Vec3 => ({ x, y, z }),

  clone: (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z }),

  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),

  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),

  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),

  /** a + b * s. Common enough in the movement integrator to be worth its own call. */
  scaleAndAdd: (a: Vec3, b: Vec3, s: number): Vec3 => ({
    x: a.x + b.x * s,
    y: a.y + b.y * s,
    z: a.z + b.z * s,
  }),

  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,

  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),

  lengthSq: (a: Vec3): number => vec3.dot(a, a),

  length: (a: Vec3): number => Math.sqrt(vec3.dot(a, a)),

  /** Speed ignoring vertical component - this is the number that matters for bhop/surf tuning. */
  horizontalLength: (a: Vec3): number => Math.sqrt(a.x * a.x + a.z * a.z),

  normalize: (a: Vec3): Vec3 => {
    const len = vec3.length(a);
    if (len < 1e-8) return vec3.zero();
    return vec3.scale(a, 1 / len);
  },
};
