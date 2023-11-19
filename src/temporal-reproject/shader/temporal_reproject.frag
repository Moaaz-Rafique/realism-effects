﻿varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastVelocityTexture;

uniform float maxBlend;
uniform float neighborhoodClampIntensity;
uniform bool fullAccumulate;
uniform vec2 invTexSize;
uniform float cameraNear;
uniform float cameraFar;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform vec3 cameraPos;
uniform vec3 prevCameraPos;
uniform mat4 prevViewMatrix;
uniform mat4 prevCameraMatrixWorld;
uniform mat4 prevProjectionMatrix;
uniform mat4 prevProjectionMatrixInverse;

uniform float keepData;

#define EPSILON 0.00001

#define DIFFUSE_SPECULAR 0
#define DIFFUSE 1
#define SPECULAR 2

#include <gbuffer_packing>
#include <packing>
#include <reproject>

vec3 reprojectedUvDiffuse = vec3(-1.0), reprojectedUvSpecular = vec3(-1.0);

// this function does the final accumulation of the input texture and the accumulated texture
// it computes a final blend value, taking into account factors such as movement and confidence
void accumulate(inout vec4 outputColor, inout vec4 inp, inout vec4 acc, inout float roughness, inout float moveFactor, bool doReprojectSpecular) {
  vec3 reprojectedUvConfidence = doReprojectSpecular ? reprojectedUvSpecular : reprojectedUvDiffuse;

  vec2 reprojectedUv = reprojectedUvConfidence.xy;
  float confidence = reprojectedUvConfidence.z;
  confidence = pow(confidence, confidencePower);

  float accumBlend = 1. - 1. / (acc.a + 1.0);
  accumBlend = mix(0., accumBlend, confidence);

  float maxValue = (fullAccumulate ? 1. : maxBlend) * keepData; // keepData is a flag that is either 1 or 0 when we call reset()

  // const float roughnessMaximum = 0.025;

  // if (doReprojectSpecular && roughness >= 0.0 && roughness < roughnessMaximum) {
  //   float maxRoughnessValue = mix(0.8, maxValue, roughness / roughnessMaximum);
  //   maxValue = mix(maxValue, maxRoughnessValue, moveFactor);
  // }

  float temporalReprojectMix = min(accumBlend, maxValue);

  // calculate the alpha from temporalReprojectMix
  acc.a = 1. / (1. - temporalReprojectMix) - 1.;
  acc.a = min(65536., acc.a);

  outputColor.rgb = mix(inp.rgb, acc.rgb, temporalReprojectMix);
  outputColor.a = acc.a;
  undoColorTransform(outputColor.rgb);
  // outputColor.rgb = vec3(moveFactor);
}

// this function reprojects the input texture to the current frame
// it calculates a confidence value for the reprojection by which the input texture is blended with the accumulated texture
void reproject(inout vec4 inp, inout vec4 acc, sampler2D accumulatedTexture, inout bool wasSampled, bool doNeighborhoodClamp,
               bool doReprojectSpecular) {
  // Get the reprojected UV coordinate.
  vec3 uvc = doReprojectSpecular ? reprojectedUvSpecular : reprojectedUvDiffuse;
  vec2 uv = uvc.xy;

  // Sample the accumulated texture.
  acc = sampleReprojectedTexture(accumulatedTexture, uv);
  transformColor(acc.rgb);

  // If we haven't sampled before, simply use the sample.
  if (!wasSampled) {
    inp.rgb = acc.rgb;
    return;
  }

  // Add one more frame.
  acc.a++;

  // Apply neighborhood clamping, if enabled.
  vec3 clampedColor = acc.rgb;
  clampNeighborhood(inputTexture, clampedColor, inp.rgb, neighborhoodClampRadius, doReprojectSpecular);
  float r = doReprojectSpecular ? roughness : 1.0;

  float clampIntensity = mix(1., min(1., moveFactor * 50. + neighborhoodClampIntensity), uvc.z * r * (1. - angleMix));
  // moveFactor = clampIntensity;

  vec3 newColor = mix(acc.rgb, clampedColor, clampIntensity);

  // check how much the color has changed
  float colorDiff = min(length(newColor - acc.rgb), 1.);
  // moveFactor = colorDiff;

  acc.a *= 1. - colorDiff;

  acc.rgb = newColor;
}

void preprocessInput(inout vec4 texel, inout bool sampledThisFrame) {
  sampledThisFrame = texel.r >= 0.;
  transformColor(texel.rgb);
}

void getTexels(inout vec4 inputTexel[textureCount], inout bool sampledThisFrame[textureCount]) {
#if inputType == DIFFUSE_SPECULAR
  unpackTwoVec4(textureLod(inputTexture, vUv, 0.0), inputTexel[0], inputTexel[1]);

  preprocessInput(inputTexel[0], sampledThisFrame[0]);
  preprocessInput(inputTexel[1], sampledThisFrame[1]);
#else
  inputTexel[0] = textureLod(inputTexture, vUv, 0.0);
  preprocessInput(inputTexel[0], sampledThisFrame[0]);
#endif
}

void computeGVariables(vec2 dilatedUv, float depth) {
  worldPos = screenSpaceToWorldSpace(dilatedUv, depth, cameraMatrixWorld, projectionMatrixInverse);
  vec3 viewPos = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  viewDir = normalize(viewPos);
  vec3 viewNormal = (vec4(worldNormal, 0.0) * viewMatrix).xyz;
  viewAngle = dot(-viewDir, viewNormal);
}

void computeReprojectedUv(float depth, vec3 worldPos, vec3 worldNormal) {
  reprojectedUvDiffuse = getReprojectedUV(false, depth, worldPos, worldNormal);

#if inputType == DIFFUSE_SPECULAR || inputType == SPECULAR
  reprojectedUvSpecular = getReprojectedUV(true, depth, worldPos, worldNormal);

  if (reprojectedUvSpecular.x == -1.0) {
    reprojectedUvSpecular = reprojectedUvDiffuse;
  }
#endif
}

void getRoughnessRayLength(vec4 inputTexel[textureCount]) {
#if inputType == DIFFUSE_SPECULAR
  rayLength = inputTexel[1].a;
  roughness = max(0., inputTexel[0].a);
#elif inputType == SPECULAR
  rayLength = inputTexel[0].a;
#endif
}

void main() {
  vec2 dilatedUv = vUv;
  getVelocityNormalDepth(dilatedUv, velocity, worldNormal, depth);

  vec4 inputTexel[textureCount], accumulatedTexel[textureCount];
  bool textureSampledThisFrame[textureCount];

  getTexels(inputTexel, textureSampledThisFrame);

  // ! todo: find better solution

  if (depth == 1.0 && fwidth(depth) == 0.0) {
    discard;
    return;
  }

  computeGVariables(dilatedUv, depth);
  getRoughnessRayLength(inputTexel);
  computeReprojectedUv(depth, worldPos, worldNormal);

  moveFactor = dot(velocity, velocity) * 10000.;

#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    reproject(inputTexel[i], accumulatedTexel[i], accumulatedTexture[i], textureSampledThisFrame[i], neighborhoodClamp[i], reprojectSpecular[i]);
    accumulate(gOutput[i], inputTexel[i], accumulatedTexel[i], roughness, moveFactor, reprojectSpecular[i]);
  }
#pragma unroll_loop_end
}