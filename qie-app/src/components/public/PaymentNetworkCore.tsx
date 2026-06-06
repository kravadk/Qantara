import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const NODE_POSITIONS: Array<[number, number, number]> = [
  [-2.8, 0.4, 0],
  [-1.25, -0.85, 0.2],
  [0, 0.72, 0],
  [1.35, -0.55, -0.15],
  [2.85, 0.45, 0],
];

function CoreScene() {
  const group = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const railMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#F02C78',
    emissive: '#7e22ce',
    emissiveIntensity: 0.45,
    roughness: 0.36,
    metalness: 0.55,
  }), []);
  const nodeMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#f97316',
    emissive: '#F02C78',
    emissiveIntensity: 0.55,
    roughness: 0.28,
    metalness: 0.7,
  }), []);
  const receiptMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#F02C78',
    emissiveIntensity: 0.2,
    roughness: 0.22,
    metalness: 0.3,
  }), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.22) * 0.16;
      group.current.rotation.x = Math.sin(t * 0.16) * 0.08;
    }
    if (pulse.current) {
      const scale = 1 + Math.sin(t * 2.4) * 0.08;
      pulse.current.scale.setScalar(scale);
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[-3, 3, 4]} intensity={8} color="#F02C78" />
      <pointLight position={[3, -1, 4]} intensity={5} color="#f97316" />
      <group ref={group}>
        <mesh ref={pulse} position={[0, 0, 0]}>
          <torusGeometry args={[1.25, 0.025, 24, 160]} />
          <meshStandardMaterial color="#F02C78" emissive="#F02C78" emissiveIntensity={0.75} transparent opacity={0.58} />
        </mesh>

        <mesh rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.52, 0.52, 0.16]} />
          <meshStandardMaterial color="#0d0a18" emissive="#7e22ce" emissiveIntensity={0.4} metalness={0.6} roughness={0.25} />
        </mesh>

        {NODE_POSITIONS.map((position, index) => (
          <mesh key={index} position={position}>
            {index === NODE_POSITIONS.length - 1 ? <octahedronGeometry args={[0.28, 1]} /> : <sphereGeometry args={[0.22 + index * 0.015, 32, 32]} />}
            <primitive object={index === NODE_POSITIONS.length - 1 ? receiptMaterial : nodeMaterial} attach="material" />
          </mesh>
        ))}

        {NODE_POSITIONS.slice(0, -1).map((from, index) => {
          const to = NODE_POSITIONS[index + 1];
          const mid = new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
          const start = new THREE.Vector3(...from);
          const end = new THREE.Vector3(...to);
          const length = start.distanceTo(end);
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          return (
            <mesh key={`${index}-rail`} position={mid} rotation={[0, 0, angle]}>
              <boxGeometry args={[length, 0.055, 0.055]} />
              <primitive object={railMaterial} attach="material" />
            </mesh>
          );
        })}

        {Array.from({ length: 34 }).map((_, index) => {
          const angle = (index / 34) * Math.PI * 2;
          const radius = 2.15 + (index % 4) * 0.18;
          return (
            <mesh key={`spark-${index}`} position={[Math.cos(angle) * radius, Math.sin(angle) * radius * 0.55, -0.55 - (index % 3) * 0.08]}>
              <sphereGeometry args={[0.018 + (index % 3) * 0.006, 12, 12]} />
              <meshBasicMaterial color={index % 2 ? '#F02C78' : '#f97316'} transparent opacity={0.82} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

export function PaymentNetworkCore() {
  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-[2rem] border border-primary/20 bg-[#090611] shadow-[0_30px_120px_-40px_rgba(240,44,120,0.7)] md:h-[560px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(240,44,120,0.22),transparent_42%),radial-gradient(circle_at_25%_72%,rgba(249,115,22,0.16),transparent_34%)]" />
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 46 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        dpr={[1, 1.7]}
      >
        <CoreScene />
      </Canvas>
      <div className="pointer-events-none absolute inset-x-5 bottom-5 grid grid-cols-3 gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
        <span className="rounded-full border border-border-default bg-bg-base/70 px-3 py-2 backdrop-blur">Payer</span>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-primary backdrop-blur">Verified rail</span>
        <span className="rounded-full border border-border-default bg-bg-base/70 px-3 py-2 text-right backdrop-blur">Receipt</span>
      </div>
    </div>
  );
}
