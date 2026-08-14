// Minimal Vec3 math. Kept dependency-free so this package has zero runtime deps and can be
// imported unmodified by both the browser client and the Node server.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = {
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),

  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),

  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),

  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),

  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,

  length: (a: Vec3): number => Math.sqrt(vec3.dot(a, a)),

  normalize: (a: Vec3): Vec3 => {
    const len = vec3.length(a);
    if (len < 1e-8) return vec3.zero();
    return vec3.scale(a, 1 / len);
  },
};
