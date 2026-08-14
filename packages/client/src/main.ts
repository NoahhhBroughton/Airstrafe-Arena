// Phase 0 scaffold: a bare Three.js scene with a ground plane and a box, just to confirm the
// render loop runs cleanly. Phase 1 replaces this with pointer-lock movement + the fixed-tick
// simulation loop described in docs/ARCHITECTURE.md - do not build gameplay directly on top of
// this file without that structure in place.

import * as THREE from "three";

const app = document.getElementById("app")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222233);

const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 60, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: 0x445544 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(50, 50, 50),
  new THREE.MeshStandardMaterial({ color: 0xcc5544 }),
);
box.position.set(0, 25, 0);
scene.add(box);

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(100, 200, 100);
scene.add(light);
scene.add(new THREE.AmbientLight(0x666666));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  box.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();
