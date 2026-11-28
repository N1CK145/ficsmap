import { useEffect, useRef } from 'react';
import {
  Box3, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, HemisphereLight,
  Material, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Plane, Points, PointsMaterial, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAVE_MODEL_LANDSCAPE } from '../../../shared/caveModels.js';
import { mapStyle } from '../map/mapStyle.js';
import { cutHeight, ueToModel, type ViewerMarker } from './caveModels.js';

export type ViewerStatus = { kind: 'loading'; progress: number | null } | { kind: 'ready' } | { kind: 'error'; reason: 'webgl' | 'load' };

export interface CaveViewer3dProps {
  url: string;
  /** 0..1: everything above this share of the model's height is cut away (1: nothing). */
  cut: number;
  /** Shows the landscape around the cave (see-through). */
  surface: boolean;
  markers: readonly ViewerMarker[];
  /** Changing it puts the camera back to the start view. */
  resetKey: number;
  onStatus(status: ViewerStatus): void;
}

interface Handles {
  requestRender(): void;
  plane: Plane;
  landscape: Object3D[];
  minY: number;
  maxY: number;
  reset(): void;
}

/** Colour tokens of the dark palette: the 3D view, like the map, stays dark in the light theme. */
const css = (name: string, fallback: string) => mapStyle().getPropertyValue(name).trim() || fallback;

/** A round, soft-edged dot for the markers (points are squares otherwise). */
function dotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#000000';
  g.stroke();
  return new CanvasTexture(c);
}

/**
 * The three.js view of one cave model (loaded on demand: three.js is not in the main bundle). Drag rotates, the
 * wheel or a pinch zooms, right-drag or two fingers pan (OrbitControls). Rock is shaded by height, the landscape is
 * see-through, a horizontal cut removes everything above a height, and entrances and collectibles show as dots
 * through the rock. Renders only when something changed.
 */
export default function CaveViewer3d({ url, cut, surface, markers, resetKey, onStatus }: CaveViewer3dProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handles = useRef<Handles | null>(null);
  const statusRef = useRef(onStatus);
  useEffect(() => { statusRef.current = onStatus; });
  // Read when a model has loaded; the markers belong to the cave, and so to the URL.
  const settings = useRef({ cut, surface, markers });
  settings.current = { cut, surface, markers };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true });
    } catch {
      statusRef.current({ kind: 'error', reason: 'webgl' });
      return;
    }
    statusRef.current({ kind: 'loading', progress: null });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.domElement.className = 'block h-full w-full';
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(css('--color-bg', '#131416'));
    const camera = new PerspectiveCamera(50, 1, 1, 10000);
    scene.add(camera);
    // A light that moves with the camera, so the side looked at is always lit, plus a soft sky light.
    const headlight = new DirectionalLight(0xffffff, 1.8);
    headlight.position.set(0.4, 0.6, 0.2);
    camera.add(headlight);
    camera.add(headlight.target);
    scene.add(new HemisphereLight(0xffffff, 0x404040, 0.9));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    let dirty = true;
    const requestRender = () => { dirty = true; };
    controls.addEventListener('change', requestRender);
    renderer.setAnimationLoop(() => {
      const moving = controls.update();
      if (!dirty && !moving) return;
      dirty = false;
      renderer.render(scene, camera);
    });
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const plane = new Plane(new Vector3(0, -1, 0), 1e9);
    const disposables: { dispose(): void }[] = [];
    let disposed = false;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(url, gltf => {
      if (disposed) return;
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(root);
      const minY = bounds.min.y, maxY = bounds.max.y;
      const deep = new Color(css('--color-cave-deep', '#3F5A73'));
      const high = new Color(css('--color-cave-high', '#C9B48F'));
      const landscape: Object3D[] = [];
      const v = new Vector3();
      const c = new Color();
      root.traverse(o => {
        if (!(o instanceof Mesh)) return;
        const geometry = o.geometry as BufferGeometry;
        disposables.push(geometry);
        let material: Material;
        if (o.name === CAVE_MODEL_LANDSCAPE) {
          landscape.push(o);
          material = new MeshStandardMaterial({
            color: css('--color-cave-surface', '#6F8A5A'), flatShading: true, roughness: 1, metalness: 0, side: DoubleSide,
            transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: [plane],
          });
          o.renderOrder = 1;
        } else {
          // Rock shaded by height: deep blue at the bottom of the model, sand at the top.
          const pos = geometry.getAttribute('position') as BufferAttribute;
          const colors = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            c.copy(deep).lerp(high, maxY > minY ? (v.y - minY) / (maxY - minY) : 0.5);
            colors.set([c.r, c.g, c.b], i * 3);
          }
          geometry.setAttribute('color', new BufferAttribute(colors, 3));
          material = new MeshStandardMaterial({
            vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, side: DoubleSide, clippingPlanes: [plane],
          });
        }
        disposables.push(material);
        o.material = material;
      });
      scene.add(root);

      const dot = dotTexture();
      disposables.push(dot);
      for (const kind of ['entrance', 'item'] as const) {
        const list = settings.current.markers.filter(m => m.kind === kind);
        if (list.length === 0) continue;
        const positions: number[] = [];
        const colors: number[] = [];
        for (const m of list) {
          positions.push(...ueToModel(m.x, m.y, m.z + (kind === 'item' ? 50 : 150)));
          c.set(m.color);
          colors.push(c.r, c.g, c.b);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
        // Seen through the rock (no depth test), the same size at every distance.
        const material = new PointsMaterial({
          size: kind === 'entrance' ? 18 : 13, sizeAttenuation: false, vertexColors: true, map: dot, alphaTest: 0.4, depthTest: false, transparent: true,
        });
        disposables.push(geometry, material);
        const points = new Points(geometry, material);
        points.renderOrder = 2;
        scene.add(points);
      }

      const center = bounds.getCenter(new Vector3());
      const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 10);
      // Fit the model's bounding sphere into the narrower of the two view angles (a phone held upright).
      const halfV = (camera.fov * Math.PI) / 360;
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      const distance = radius / Math.sin(Math.min(halfV, halfH));
      camera.near = Math.max(0.5, radius / 500);
      camera.far = distance * 6;
      camera.updateProjectionMatrix();
      controls.maxDistance = distance * 3;
      const reset = () => {
        controls.target.copy(center);
        camera.position.copy(center).add(new Vector3(0.75, 0.9, 1).normalize().multiplyScalar(distance * 0.8));
        controls.update();
        requestRender();
      };
      reset();
      handles.current = { requestRender, plane, landscape, minY, maxY, reset };
      plane.constant = cutHeight(settings.current.cut, minY, maxY);
      for (const o of landscape) o.visible = settings.current.surface;
      statusRef.current({ kind: 'ready' });
    }, e => {
      if (!disposed) statusRef.current({ kind: 'loading', progress: e.lengthComputable && e.total > 0 ? e.loaded / e.total : null });
    }, () => {
      if (!disposed) statusRef.current({ kind: 'error', reason: 'load' });
    });

    return () => {
      disposed = true;
      handles.current = null;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // Phones allow only a few WebGL contexts: give this one back right away.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [url]);

  useEffect(() => {
    const h = handles.current;
    if (!h) return;
    h.plane.constant = cutHeight(cut, h.minY, h.maxY);
    for (const o of h.landscape) o.visible = surface;
    h.requestRender();
  }, [cut, surface]);

  useEffect(() => { handles.current?.reset(); }, [resetKey]);

  return <div ref={hostRef} className="absolute inset-0 touch-none" data-testid="cave-viewer-canvas" />;
}
