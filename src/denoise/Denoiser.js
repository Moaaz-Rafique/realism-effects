import { TemporalReprojectPass } from "../temporal-reproject/TemporalReprojectPass"
import { PoissionDenoisePass } from "./PoissionDenoisePass"

// todo: implement this
export default class Denoiser {
	constructor(
		scene,
		camera,
		texture,
		velocityDepthNormalPass,
		options = {
			gBufferPass: null
		}
	) {
		this.temporalReprojectPass = new TemporalReprojectPass(scene, camera, velocityDepthNormalPass, 2, {
			fullAccumulate: true,
			logTransform: true,
			copyTextures: false
		})

		this.temporalReprojectPass.setTextures(texture)

		const textures = this.temporalReprojectPass.renderTarget.texture.slice(0, 2)

		this.denoisePass = new PoissionDenoisePass(camera, textures[0])
		this.denoisePass.inputTexture2 = textures[1]
		this.denoisePass.setGBufferPass(options.gBufferPass || velocityDepthNormalPass)

		this.temporalReprojectPass.overrideAccumulatedTextures = this.denoisePass.renderTargetB.texture
	}

	get texture() {
		return this.denoisePass.texture
	}

	reset() {
		this.temporalReprojectPass.reset()
	}

	setSize(width, height) {
		this.denoisePass.setSize(width, height)
		this.temporalReprojectPass.setSize(width, height)
	}

	dispose() {
		this.denoisePass.dispose()
		this.temporalReprojectPass.dispose()
	}

	denoise(renderer) {
		this.temporalReprojectPass.render(renderer)
		this.denoisePass.render(renderer)
	}
}
