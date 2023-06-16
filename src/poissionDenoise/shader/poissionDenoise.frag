varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform sampler2D directLightTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float diffusePhi;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform int index;
uniform vec2 resolution;
uniform bool isLastIteration;

layout(location = 0) out vec4 gOutput0;
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>
#include <sampleBlueNoise>

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

// ! TODO: fix log space issue with certain models (NaN pixels) for example: see seiko-watch 3D model
void toLogSpace(inout vec3 color) {
    // color = dot(color, color) > 0.000000001 ? log(color) : vec3(0.000000001);
    // color = pow(color, vec3(1. / 8.));
}

void toLinearSpace(inout vec3 color) {
    // color = exp(color);
    // color = pow(color, vec3(8.));
}

void evaluateNeighbor(const vec4 neighborTexel, inout vec3 denoised,
                      inout float totalWeight, const float basicWeight) {
    float w = basicWeight;
    // w *= luminance(neighborTexel.rgb);
    w = min(w, 1.);

    denoised += w * neighborTexel.rgb;
    totalWeight += w;
}

float getFlatness(vec3 g, vec3 rp) {
    vec3 gw = fwidth(g);
    vec3 pw = fwidth(rp);

    float wfcurvature = length(gw) / length(pw);
    wfcurvature = smoothstep(0.0, 30., wfcurvature);

    return clamp(wfcurvature, 0., 1.);
}

const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);
    vec4 texel2 = textureLod(inputTexture2, vUv, 0.0);

    float min1 = min(texel.r, min(texel.g, texel.b));
    float min2 = min(texel2.r, min(texel2.g, texel2.b));

    bool useLogSpace = min1 > 0.000000001;
    bool useLogSpace2 = min2 > 0.000000001;

    if (useLogSpace) toLogSpace(texel.rgb);
    if (useLogSpace2) toLogSpace(texel2.rgb);

    vec3 diffuse, normal, emissive;
    float roughness, metalness;

    getGData(gBuffersTexture, vUv, diffuse, normal, roughness, metalness, emissive);

#ifdef NORMAL_IN_RGB
    float denoised = texel.a;
    float center = texel.a;
#else
    vec3 denoised = texel.rgb;
    vec3 center = texel.rgb;

    vec3 denoised2 = texel2.rgb;
    vec3 center2 = texel2.rgb;
#endif

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);
    float flatness = getFlatness(worldPos, normal);

    float totalWeight = 1.0;
    float totalWeight2 = 1.0;

    vec3 random = sampleBlueNoise(blueNoiseTexture, index, blueNoiseRepeat, resolution).rgb;

    float specularWeight = roughness * roughness > 0.15 ? 1. : roughness * roughness / 0.15;
    specularWeight *= specularWeight;

    float a = min(texel.a, texel2.a) + 1.;
    float r = 32. * pow(8., -0.1 * a) + 4.;
    float w = 1. / pow(texel.a + 1., 1. / 3.);
    float w2 = 1. / pow(texel2.a + 1., 1. / 3.);

    const vec2 bilinearOffsets[4] = vec2[](
        vec2(0.5, 0.5),
        vec2(-0.5, 0.5),
        vec2(0.5, -0.5),
        vec2(-0.5, -0.5));

    float angle = mod(random.r * float(1), hn.r) * 2. * PI;
    for (int i = 0; i < samples; i++) {
        float s = sin(angle), c = cos(angle);
        mat2 rotationMatrix = mat2(c, -s, s, c);

        vec2 offset = r * rotationMatrix * poissonDisk[i] * 0.2;

        // float randomZ = mod(random.b * float(i + 1), hn.b);
        vec2 neighborUv = vUv + offset;  // + bilinearOffsets[int(round(randomZ * 4.))] / resolution;

        vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.);
        vec4 neighborTexel2 = textureLod(inputTexture2, neighborUv, 0.);

        if (useLogSpace) toLogSpace(neighborTexel.rgb);
        if (useLogSpace2) toLogSpace(neighborTexel2.rgb);

        vec3 neighborNormal, neighborDiffuse;
        float neighborRoughness, neighborMetalness;

        getGData(gBuffersTexture, neighborUv, neighborDiffuse, neighborNormal, neighborRoughness, neighborMetalness);

        float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).x;
        vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

        float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
        float depthDiff = 1. + distToPlane(worldPos, neighborWorldPos, normal);
        depthDiff = depthDiff * depthDiff - 1.;

        float roughnessDiff = abs(roughness - neighborRoughness);
        float diffuseDiff = length(neighborDiffuse - diffuse);

        float lumaDiff = abs(luminance(neighborTexel.rgb) - luminance(neighborTexel2.rgb));

        float normalFac = mix(-normalDiff * normalPhi, 0., 1. / a);

        float similarity = float(neighborDepth != 1.0) *
                           exp(normalFac - depthDiff * depthPhi - roughnessDiff * roughnessPhi - diffuseDiff * diffusePhi);

        float simW = lumaPhi;
        float similarity2 = w2 * pow(similarity, 2. * simW / w2) * specularWeight;

        similarity *= w;
        similarity = pow(similarity, simW / w);

        evaluateNeighbor(neighborTexel, denoised, totalWeight, similarity);
        evaluateNeighbor(neighborTexel2, denoised2, totalWeight2, similarity2);
    }

    denoised /= totalWeight;
    denoised2 /= totalWeight2;

    if (useLogSpace) toLinearSpace(denoised);
    if (useLogSpace2) toLinearSpace(denoised2);

#define FINAL_OUTPUT

    gOutput0 = vec4(denoised, texel.a);
    gOutput1 = vec4(denoised2, texel2.a);
}