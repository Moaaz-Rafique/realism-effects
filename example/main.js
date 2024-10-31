import { getGPUTier } from "detect-gpu"
import dragDrop from "drag-drop"
import * as POSTPROCESSING from "postprocessing"
import { MotionBlurEffect, SSGIEffect, TRAAEffect, VelocityDepthNormalPass } from "realism-effects"
import * as THREE from "three"
import { Box3, Clock, DirectionalLight, EquirectangularReflectionMapping, FloatType, Object3D, Vector3 } from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { GroundProjectedSkybox } from "three/examples/jsm/objects/GroundProjectedSkybox"
import { Pane } from "tweakpane"
import "./style.css"

let traaEffect
let traaPass
let smaaPass
let fxaaPass
let ssgiEffect
let postprocessingEnabled = true
let pane
let envMesh
let fps
const guiParams = {
	Method: "TRAA",
	Background: false
}

const scene = new THREE.Scene()
scene.matrixWorldAutoUpdate = false
window.scene = scene

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 250)
scene.add(camera)

const canvas = document.querySelector(".webgl")

let rendererCanvas = canvas

// use an offscreen canvas if available
if (window.OffscreenCanvas && !navigator.userAgent.toLowerCase().includes("firefox")) {
	rendererCanvas = canvas.transferControlToOffscreen()
	rendererCanvas.style = canvas.style
	rendererCanvas.toDataURL = canvas.toDataURL.bind(canvas)
}

// Renderer
const renderer = new THREE.WebGLRenderer({
	canvas: rendererCanvas,
	powerPreference: "high-performance",
	premultipliedAlpha: false,
	stencil: false,
	antialias: false
	// alpha: false,
	// preserveDrawingBuffer: true
})

renderer.autoClear = false

renderer.setSize(window.innerWidth, window.innerHeight)

const effectPass = new POSTPROCESSING.EffectPass(camera)

const setAA = value => {
	composer.multisampling = 0
	composer.removePass(smaaPass)
	composer.removePass(traaPass)
	composer.removePass(fxaaPass)
	composer.removePass(effectPass)

	switch (value) {
		case "TRAA":
			composer.addPass(traaPass)
			break

		case "MSAA":
			const ctx = renderer.getContext()
			composer.multisampling = Math.min(4, ctx.getParameter(ctx.MAX_SAMPLES))
			composer.addPass(effectPass)
			break

		case "FXAA":
			composer.addPass(fxaaPass)
			break

		case "SMAA":
			composer.addPass(smaaPass)
			break

		default:
			composer.addPass(effectPass)
	}

	guiParams.Method = value
	pane.refresh()
}

// since using "rendererCanvas" doesn't work when using an offscreen canvas
const controls = new OrbitControls(camera, document.querySelector("#orbitControlsDomElem"))
controls.enableDamping = true

const cameraY = 8.75
camera.position.fromArray([0, cameraY, 25])
controls.target.set(0, cameraY, 0)
controls.maxPolarAngle = Math.PI / 2
controls.minDistance = 5
window.controls = controls
window.camera = camera

const composer = new POSTPROCESSING.EffectComposer(renderer)
if (true) {
	const renderPass = new POSTPROCESSING.RenderPass(scene, camera)
	composer.addPass(renderPass)
}

const lightParams = {
	yaw: 55,
	pitch: 27,
	intensity: 0
}

const light = new DirectionalLight(0xffffff, lightParams.intensity)
light.position.set(217, 43, 76)
light.updateMatrixWorld()
light.castShadow = true
scene.add(light)

renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true

light.shadow.mapSize.width = 8192
light.shadow.mapSize.height = 8192
light.shadow.camera.near = 50
light.shadow.camera.far = 500
light.shadow.bias = -0.0001

const s = 100

light.shadow.camera.left = -s
light.shadow.camera.bottom = -s
light.shadow.camera.right = s
light.shadow.camera.top = s

const rgbeLoader = new RGBELoader().setDataType(FloatType)

const initEnvMap = async envMap => {
	scene.environment?.dispose()

	envMap.mapping = EquirectangularReflectionMapping

	scene.environment = envMap
	scene.background = null

	setEnvMesh(envMap)
}

const setEnvMesh = envMap => {
	envMesh?.removeFromParent()
	envMesh?.material.dispose()
	envMesh?.geometry.dispose()

	envMesh = new GroundProjectedSkybox(envMap)
	envMesh.radius = 100
	envMesh.height = 20
	envMesh.scale.setScalar(100)
	envMesh.updateMatrixWorld()
	scene.add(envMesh)
}

rgbeLoader.load("hdr/1.hdr", initEnvMap)

const gltflLoader = new GLTFLoader()

const draco = new DRACOLoader()
draco.setDecoderConfig({ type: "js" })
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
// gltflLoader.setPath("gltf/")
gltflLoader.setDRACOLoader(draco)

let url
let loadFiles

url = "squid_game.optimized.glb"
url = "/assets/start13.glb"
loadFiles = 1

let lastScene

gltflLoader.load(url, asset => {
	setupAsset(asset)
})

const toRad = Math.PI / 180

const refreshLighting = () => {
	light.position.x = Math.sin(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)
	light.position.y = Math.sin(lightParams.pitch * toRad)
	light.position.z = Math.cos(lightParams.yaw * toRad) * Math.cos(lightParams.pitch * toRad)

	light.position.normalize().multiplyScalar(75)
	light.updateMatrixWorld()
	renderer.shadowMap.needsUpdate = true
}

const initScene = async () => {
	const gpuTier = await getGPUTier()
	fps = gpuTier.fps
	fps = 512

	const options = {
		distance: 2.7200000000000104,
		thickness: 1.2999999999999972,
		autoThickness: false,
		maxRoughness: 1,
		blend: 0.95,
		denoiseIterations: 3,
		denoiseKernel: 3,
		denoiseDiffuse: 25,
		denoiseSpecular: 25.54,
		depthPhi: 5,
		normalPhi: 28,
		roughnessPhi: 18.75,
		envBlur: 0.5,
		importanceSampling: true,
		directLightMultiplier: 1,
		steps: 20,
		refineSteps: 4,
		spp: 10,
		resolutionScale: 1,
		missedRays: false
	}

	const velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera)
	composer.addPass(velocityDepthNormalPass)

	traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass)

	pane = new Pane()
	pane.containerElem_.style.userSelect = "none"
	pane.containerElem_.style.width = "380px"

	const aaFolder = pane.addFolder({ title: "Anti-aliasing", expanded: false })

	aaFolder
		.addInput(guiParams, "Method", {
			options: {
				TRAA: "TRAA",

				MSAA: "MSAA",
				FXAA: "FXAA",
				SMAA: "SMAA",
				Disabled: "Disabled"
			}
		})
		.on("change", ev => {
			setAA(ev.value)
		})

	// const modelNames = [
	// 	"amg",
	// 	"chevrolet",
	// 	"clay_bust_study",
	// 	"cyberpunk_bike",
	// 	"cyber_samurai",
	// 	"darth_vader",
	// 	"flashbang_grenade",
	// 	"motorbike",
	// 	"statue",
	// 	"squid_game",
	// 	"swordsman"
	// ]

	const sceneParams = { Environment: 1 }
	const environments = [1, 2, 3, 4, 5, 6, 7]

	const assetsFolder = pane.addFolder({ title: "Assets" })
	assetsFolder
		.addInput(sceneParams, "Environment", {
			min: 1,
			max: environments.length,
			step: 1
		})
		.on("change", ev => {
			const envIndex = ev.value - 1
			rgbeLoader.load("hdr/" + environments[envIndex].toString() + ".hdr", initEnvMap)
		})
	// assetsFolder
	// 	.addInput(sceneParams, "Model", {
	// 		options: modelObject
	// 	})
	// 	.on("change", ev => {
	// 		gltflLoader.load(ev.value + ".optimized.glb", setupAsset)
	// 	})

	const bloomEffect = new POSTPROCESSING.BloomEffect({
		intensity: 1,
		mipmapBlur: true,
		luminanceSmoothing: 0.75,
		luminanceThreshold: 0.75,
		kernelSize: POSTPROCESSING.KernelSize.HUGE
	})

	const vignetteEffect = new POSTPROCESSING.VignetteEffect({
		darkness: 0.8,
		offset: 0.3
	})

	ssgiEffect = new SSGIEffect(scene, camera, velocityDepthNormalPass, options)

	new POSTPROCESSING.LUT3dlLoader().load("lut.3dl").then(lutTexture => {
		const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture)

		if (fps >= 256) {
			composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, bloomEffect, vignetteEffect, lutEffect))

			const motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass)

			composer.addPass(new POSTPROCESSING.EffectPass(camera, motionBlurEffect))
		} else {
			composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, vignetteEffect, lutEffect))
			loadFiles--
		}

		traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect)

		const smaaEffect = new POSTPROCESSING.SMAAEffect()

		smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect)

		const fxaaEffect = new POSTPROCESSING.FXAAEffect()

		fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect)

		if (fps >= 256) {
			setAA("TRAA")

			resize()
		} else {
			setAA("FXAA")
			controls.enableDamping = false

			resize()
		}

		loop()

		const display = pane.element.style.display === "none" ? "block" : "none"

		pane.element.style.display = display
	})
}

const clock = new Clock()

const loop = () => {
	if (lastScene?.children) {
		// lastScene.children[0].position += Math.sin(clock.elapsedTime) * 100
		// lastScene.children[0].updateMatrixWorld()
	}
	const dt = clock.getDelta()

	if (true) {
		lastScene?.updateMatrixWorld?.()
		refreshLighting()
	}

	if (controls.enableDamping) controls.dampingFactor = 0.075 * 120 * Math.max(1 / 1000, dt)

	controls.update()
	camera.updateMatrixWorld()

	if (postprocessingEnabled) {
		composer.render()
	} else {
		renderer.clear()
		renderer.render(scene, camera)
	}

	window.requestAnimationFrame(loop)
}

const resize = () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()

	const dpr = window.devicePixelRatio
	renderer.setPixelRatio(fps < 256 ? Math.max(1, dpr * 0.5) : dpr)

	renderer.setSize(window.innerWidth, window.innerHeight)
	composer.setSize(window.innerWidth, window.innerHeight)
}

window.addEventListener("resize", resize)

const aaOptions = {
	1: "TRAA",
	2: "MSAA",
	3: "FXAA",
	4: "SMAA",
	5: "Disabled"
}

const aaValues = Object.values(aaOptions)

const toggleMenu = () => {
	pane.element.style.display = pane.element.style.display === "none" ? "block" : "none"
}

document.addEventListener("keydown", ev => {
	if (document.activeElement.tagName !== "INPUT") {
		const value = aaOptions[ev.key]
		if (value) setAA(value)
	}

	if (ev.code === "KeyQ") {
		postprocessingEnabled = !postprocessingEnabled
		refreshLighting()
	}
	if (ev.code === "Tab") {
		ev.preventDefault()
		toggleMenu()
	}
})

dragDrop("body", files => {
	const file = files[0]

	const reader = new FileReader()
	reader.addEventListener("load", e => {
		// e.target.result is an ArrayBuffer
		const arr = new Uint8Array(e.target.result)
		const { buffer } = arr

		gltflLoader.parse(buffer, "", setupAsset)
	})

	reader.readAsArrayBuffer(file)
})

const pointsObj = new Object3D()
scene.add(pointsObj)

const setupAsset = asset => {
	if (pointsObj.children.length > 0) {
		pointsObj.removeFromParent()
	}

	if (lastScene) {
		lastScene.removeFromParent()
		lastScene.traverse(c => {
			if (c.isMesh) {
				c.geometry.dispose()
				c.material.dispose()
			}
		})
	}

	scene.add(asset.scene)
	asset.scene.scale.setScalar(1)

	asset.scene.traverse(child => {
		if (child.isMesh) {
			child.castShadow = child.receiveShadow = true
			child.material.depthWrite = true
			if (child.material.transparent) child.material.alphaMap = child.material.roughnessMap
		}

		child.frustumCulled = false
	})

	const bb = new Box3()
	bb.setFromObject(asset.scene)
	const height = bb.max.y - bb.min.y
	const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
	const targetHeight = 15
	const targetWidth = 45
	const scaleWidth = targetWidth / width
	const scaleHeight = targetHeight / height
	asset.scene.scale.multiplyScalar(Math.min(scaleWidth, scaleHeight))
	asset.scene.updateMatrixWorld()
	bb.setFromObject(asset.scene)
	const center = new Vector3()
	bb.getCenter(center)
	center.y = bb.min.y
	asset.scene.position.sub(center)
	scene.updateMatrixWorld()
	lastScene = asset.scene
	requestAnimationFrame(refreshLighting)
}

initScene()
