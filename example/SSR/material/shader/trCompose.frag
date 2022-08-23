﻿const float alphaStep = 0.01;

alpha = didReproject && depthDiff <= maxNeighborDepthDifference ? (alpha + alphaStep) : 0.0;

if (isMoving) alpha = min(alpha, alphaStep * 24.);
// if (isMoving) alpha = min(alpha, alphaStep * 64.);

float m = blend;

float currentSample = alpha / alphaStep + 1.0;
m = 1. - 1. / currentSample;
m = min(blend, m);

#ifdef neighborhoodClamping
if (alpha <= 0.05) inputColor = boxBlurredColor;
#endif

outputColor = mix(accumulatedColor, inputColor, 1.0 - m);

// outputColor = vec3(alpha);

// if (alpha < 0.1)
//     outputColor = vec3(0., 1., 0.);
// else
//     outputColor = vec3(0.);