import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Environment, Float, Text } from '@react-three/drei';
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

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

  // Permutations
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

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

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

const LiquidSphere = () => {
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const textMaterialRef1 = useRef<THREE.MeshBasicMaterial>(null);
  const textMaterialRef2 = useRef<THREE.MeshBasicMaterial>(null);
  
  const hoverValue = useRef(0);
  const clickBoost = useRef(0);

  const onBeforeCompileLiquid = (shader: any) => {
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
        float hoverIntensity = 0.5 + uHover * 1.0;
        float displacement = combined * (0.25 * hoverIntensity);
        vDisplacement = displacement;
        transformed = position + normal * displacement;
      `
    );

    shader.fragmentShader = `
      uniform float uHover;
      ${shader.fragmentShader}
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
        #include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.8, 0.4), uHover * 0.1);
      `
    );
    
    if (materialRef.current) {
      materialRef.current.userData.uniforms = shader.uniforms;
    }
  };

  const onBeforeCompileText = (shader: any, targetRef: React.RefObject<THREE.MeshBasicMaterial | null>) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uHover = { value: 0 };

    shader.vertexShader = `
      uniform float uTime;
      uniform float uHover;
      ${noiseGLSL}
      ${shader.vertexShader}
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        float noise = snoise(vec3(position.xy * 0.5, uTime * 0.2));
        transformed.x += noise * (0.2 + uHover * 0.5);
        transformed.y += snoise(vec3(position.yx * 0.5, uTime * 0.25)) * (0.2 + uHover * 0.5);
        transformed.z += snoise(vec3(position.xy * 1.0, uTime * 0.1)) * (0.5 + uHover * 1.0);
      `
    );

    if (targetRef.current) {
      targetRef.current.userData.uniforms = shader.uniforms;
    }
  };
  
  useFrame(({ clock, mouse }) => {
    const time = clock.getElapsedTime();
    const dist = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
    const targetHover = Math.max(0, 1.0 - dist * 0.6);
    
    clickBoost.current = THREE.MathUtils.lerp(clickBoost.current, 0, 0.05);
    hoverValue.current = THREE.MathUtils.lerp(hoverValue.current, targetHover, 0.15);
    const totalInteraction = Math.min(2.0, hoverValue.current + clickBoost.current);

    const updateUniforms = (matRef: React.RefObject<THREE.Material | null>) => {
      const uniforms = matRef.current?.userData?.uniforms;
      if (uniforms) {
        uniforms.uHover.value = totalInteraction;
        uniforms.uTime.value = time * (1.0 + totalInteraction * 1.0);
      }
    };

    updateUniforms(materialRef);
    updateUniforms(textMaterialRef1);
    updateUniforms(textMaterialRef2);
  });

  return (
    <group>
      <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
        <Sphere 
          args={[2, 128, 128]} 
          onClick={(e) => {
            e.stopPropagation();
            clickBoost.current = 1.5;
          }}
        >
          <meshPhysicalMaterial
            ref={materialRef}
            color="#42b883"
            transmission={0.6}
            opacity={1}
            metalness={0.1}
            roughness={0.1}
            ior={1.4}
            thickness={1.5}
            onBeforeCompile={onBeforeCompileLiquid}
          />
        </Sphere>
      </Float>

      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.3}>
        <group position={[0, -0.3, 2.5]}>
          <Text
            fontFamily="monospace"
            position={[0, 0.2, 0]}
            fontSize={0.12}
            color="#2da44e"
            anchorX="center"
            anchorY="middle"
            maxWidth={4}
            textAlign="center"
            fillOpacity={0.8}
            letterSpacing={0.2}
          >
            Ready to tee off?
            <meshBasicMaterial ref={textMaterialRef1} onBeforeCompile={(s) => onBeforeCompileText(s, textMaterialRef1)} />
          </Text>
          <Text
            fontFamily="monospace"
            position={[0, -0.05, 0]}
            fontSize={0.04}
            color="#42b883"
            anchorX="center"
            anchorY="middle"
            maxWidth={3}
            textAlign="center"
            fillOpacity={0.6}
            letterSpacing={0.1}
          >
            Select a repository from the bag to start viewing diffs!
            <meshBasicMaterial ref={textMaterialRef2} onBeforeCompile={(s) => onBeforeCompileText(s, textMaterialRef2)} />
          </Text>
        </group>
      </Float>
    </group>
  );
};

export default function LiquidGreen() {
  return (
    <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }} dpr={[1, 2]}>
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
