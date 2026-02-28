import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Environment, Float } from '@react-three/drei';
import * as THREE from 'three';

// Simplex 3D Noise implementation (Ashima Arts)
const noiseGLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

  // Permutations
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  //Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

const onBeforeCompile = (shader: any) => {
  shader.uniforms.uTime = { value: 0 };
  shader.uniforms.uHover = { value: 0 };

  shader.vertexShader = `
    uniform float uTime;
    uniform float uHover;
    varying float vDisplacement;
    ${noiseGLSL}
    ${shader.vertexShader}
  `;

  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `
      #include <begin_vertex>
      
      float noise = snoise(vec3(position * 0.8 + uTime * 0.3));
      float noise2 = snoise(vec3(position * 2.0 - uTime * 0.2));
      float combined = noise * 0.6 + noise2 * 0.4;
      
      // Interaction: Hover increases turbulence and amplitude
      float hoverIntensity = 0.5 + uHover * 2.0;
      
      float displacement = combined * (0.4 * hoverIntensity);
      vDisplacement = displacement;
      
      transformed = position + normal * displacement;
    `
  );
  
  // Store reference to uniforms for updates
  if (!shader.userData) shader.userData = {};
  shader.userData.uniforms = shader.uniforms;
};

const LiquidSphere = () => {
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const hoverValue = useRef(0);
  
  useFrame(({ clock, mouse }) => {
    // Access uniforms via userData which we set in onBeforeCompile
    const uniforms = materialRef.current?.userData?.uniforms;
    if (uniforms) {
      const dist = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
      const targetHover = Math.max(0, 1.0 - dist * 0.6);
      
      // Snappier reaction with 0.15 lerp
      hoverValue.current = THREE.MathUtils.lerp(hoverValue.current, targetHover, 0.15);
      
      uniforms.uHover.value = hoverValue.current;
      // Faster time scaling based on interaction
      uniforms.uTime.value = clock.getElapsedTime() * (1.0 + hoverValue.current * 1.5);
    }
  });
  return (
    <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
      <Sphere args={[2, 128, 128]} pointerEvents="auto">
        <meshPhysicalMaterial
          ref={materialRef}
          color="#42b883" // Vue/Green-ish
          transmission={0.6}
          opacity={1}
          metalness={0.1}
          roughness={0.1}
          ior={1.4}
          thickness={1.5}
          onBeforeCompile={onBeforeCompile}
        />
      </Sphere>
    </Float>
  );
};

export default function LiquidGreen() {
  return (
    <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }} dpr={[1, 2]}>
        {/* White background matching the app theme */}
        <color attach="background" args={['#ffffff']} />
        
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        
        <LiquidSphere />
        
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
