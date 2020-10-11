const { touchDown, touchMove, touchUp, usleep, appActivate, keyDown, keyUp, getColor, getColors, stop } = at
const { intToRgb } = utils
const {
    // basic gestures
    swipe, sleep, tap, tapMiddle,
    // color & text recognition, polling
    readText, areColorsPresentInRegion, poll
} = require(`${at.rootDir()}/bot-common/bot-common`);

const COLOR_LEVELS = 16; // how many color levels to "round" the image to. default 16
const COLOR_TOLERANCE = 1; // when looking for lines, we can include levels +/- COLOR_TOLERANCE. default 0
const DIFF_DISTANCE = 1; // how far to search to find different colors for the same pixel on two maps. default 1
const SLOPE_DIFF_TOLERANCE = 1; // how different the pos/neg slopes can be. default 1
const DIFF_THRESHOLD = 1; // don't consider colors as different if they differ by less than this. default 1
const INTERSECT_DISTANCE = 6; // how far to look for intersections for a pixel. default 6
const CLUSTER_RADIUS = 2; // square of CLUSTER_RADIUS*2+1 is used to weight a point for being in a cluster. default 2

// given a base map, for every pixel generate a "diff" map that expresses how different the pixel is from neighbors
function generateDiffMap(arr) {
    var diffArray = new Array();

    for(let i = 0; i < arr.length; i++) {
        var dcolumn = new Array(arr[i].length);

        for(let j = 0; j < arr[i].length; j++) {
            dcolumn[j] = computeDNumber(i, j, arr);
        }

        diffArray.push(dcolumn);
    }

    return diffArray;
}

// for a point (x,y) compute its "distance" from the points up,down,left,right up to DIFF_DISTANCE
function computeDNumber(x, y, arr) {
    var diffCount = 0;

    for(let i = 0; i <= DIFF_DISTANCE; i++) {
        if(x - i >= 0) diffCount += computeColorDifference(x, y, x-i, y, arr);
        if(x + i < arr.length) diffCount += computeColorDifference(x, y, x+i, y, arr);
        if(y - i >= 0) diffCount += computeColorDifference(x, y, x, y-i, arr);
        if(y + i < arr[x].length) diffCount += computeColorDifference(x, y, x, y+i, arr);
    }
    
    return diffCount;
}

function computeColorDifference(x, y, other_x, other_y, arr) {
    // compute the difference between two points colors
    // decrease the value by DIFF_THRESHOLD to a floor of 0 to ignore small differences
    return Math.max(DIFF_THRESHOLD, Math.abs(arr[x][y] - arr[other_x][other_y])) - DIFF_THRESHOLD;
}

function intersectMaps(xmap, ymap) {
    var arr = new Array();

    for(let i = 0; i < xmap.length; i++) {
        var column = new Array(xmap[i].length);

        for(let j = 0; j < xmap[i].length; j++) {
            column[j] = computeIntersection(i, j, xmap, ymap);
        }

        arr.push(column);
    }

    return arr;
}

// for a point (x,y) and two color maps, find a "fuzzy" intersection of the two
// start with just the intersection (Math.min) of the two color values
// if INTERSECT_DISTANCE is > 0 then also intersect xmap's (x,y) color from neighbors in ymap
// finally, use FIRST_MAP_WEIGHT_FACTOR to amplify the intersection from points nearby on xmap 
// This makes clusters more important, to minimize the impact of decoys that aren't X shaped
function computeIntersection(x, y, xmap, ymap) {
    var intValue = 0;
    var up = 0;
    var down = 0;
    var left = 0;
    var right = 0;
    var clusterWeight = getClusterWeight(x, y, xmap);

    if(INTERSECT_DISTANCE == 0)
        return Math.min(xmap[x][y],ymap[x][y]);

    for(let i = 0; i <= INTERSECT_DISTANCE; i++) {
        if(x - i >= 0) left += Math.min(xmap[x][y],ymap[x-i][y]);
        if(x + i < xmap.length) right += Math.min(xmap[x][y],ymap[x+i][y]);
        if(y - i >= 0) up += Math.min(xmap[x][y],ymap[x][y-i]);
        if(y + i < xmap[x].length) down += Math.min(xmap[x][y],ymap[x][y+i]);
    }
    
    return (up+down+left+right)*(1+clusterWeight*2/COLOR_LEVELS) / Math.pow(INTERSECT_DISTANCE + 1, 2);
}

function getClusterWeight(x, y, map) {
    let clusterWeight = 0;
    for(let i = Math.max(0, x - CLUSTER_RADIUS); i < Math.min(map.length, x+CLUSTER_RADIUS); i++) {
        for(let j = Math.max(0, y - CLUSTER_RADIUS); j < Math.min(map[0].length, y+CLUSTER_RADIUS); j++) {
            clusterWeight += map[i][j];
        }
    }
    return clusterWeight / Math.pow(Math.max(1, CLUSTER_RADIUS*2), 2);
}

// given the two slope maps, find the max pair of slopes for the point. 
// also, consider neighboring points so that single width X's with a 2x2 center get found
function computeMaxSlopeMap(base, posMap, negMap) {
    var arr = new Array(posMap.length);
    for(let i = 0; i < posMap.length; i++) {
        arr[i] = new Array(posMap[0].length);
    }

    for(let x = 1; x < posMap.length - 2; x++) {
        for(let y = 1; y < posMap[0].length - 2; y++) {

            var center = findMatchingOppositeSlope(base, posMap, negMap, x, y, x, y);
            var up = findMatchingOppositeSlope(base, posMap, negMap, x, y, x, y-1);
            var down = findMatchingOppositeSlope(base, posMap, negMap, x, y, x, y+1);
            var left = findMatchingOppositeSlope(base, posMap, negMap, x, y, x-1, y);
            var right = findMatchingOppositeSlope(base, posMap, negMap, x, y, x+1, y);          
            
            arr[x][y] = Math.max(center, up, down, left, right);
        }
    }

    return arr;
}

// check the positive slope from x,y and the negative slope from ox, oy
//   if it's within tolerance, that means there are perpendicular lines of similar length that intersect
//   so then take the min of the two slopes and return that
// do the same for negative slope from x,y and positive from ox,oy
function findMatchingOppositeSlope(base, posMap, negMap, x, y, ox, oy) {
    if(base[x][y] == base[ox][oy]) {
        var posNeg = 0;
        if(Math.abs(posMap[x][y] - negMap[ox][oy]) <= SLOPE_DIFF_TOLERANCE) {
            posNeg = Math.min(posMap[x][y], negMap[ox][oy]);
        }
        var negPos = 0;
        if(Math.abs(negMap[x][y] - posMap[ox][oy]) <= SLOPE_DIFF_TOLERANCE) {
            negPos = Math.min(negMap[x][y], posMap[ox][oy]);
        }
        return Math.max(posNeg, negPos);
    } else {
        return 0;
    }
}

function initializeArray(width, height) {
    var arr = new Array(width);
    for(let i = 0; i < width; i++) {
        arr[i] = new Array(height);
    }

    return arr;
}

function computePositiveSlopeMap(base) {
    var arr = initializeArray(base.length, base[0].length);

    for(let i = 0; i < base.length; i++) {
        for(let j = 0; j < base[0].length; j++) {
            arr[i][j] = computePositiveSlope(base, i, j);
        }
    }
    
    return arr;
}

function computeNegativeSlopeMap(base) {
    var arr = initializeArray(base.length, base[0].length);

    for(let i = 0; i < base.length; i++) {
        for(let j = 0; j < base[0].length; j++) {
            arr[i][j] = computeNegativeSlope(base, i, j);
        }
    }
    
    return arr;
}

function computePositiveSlope(base, x, y) {
    var rightx = x + 1;
    var righty = y - 1;
    var leftx = x - 1;
    var lefty = y + 1;
    var width = base.length;
    var height = base[0].length;
    var span = 0;

    while(rightx < width && righty >= 0 && leftx >= 0 && lefty < height) {
        if(computeColorDifference(x, y, rightx, righty, base) <= COLOR_TOLERANCE && 
           computeColorDifference(x, y, leftx, lefty, base) <= COLOR_TOLERANCE) {
            rightx = rightx + 1;
            righty = righty - 1;
            leftx = leftx - 1;
            lefty = lefty + 1;
            span++;
        } else {
            break;
        }
    }

    return span;
}

function computeNegativeSlope(base, x, y) {
    var rightx = x + 1;
    var righty = y + 1;
    var leftx = x - 1;
    var lefty = y - 1;
    var width = base.length;
    var height = base[0].length;
    var span = 0;

    while(rightx < width && righty < height && leftx >= 0 && lefty >= 0) {
        if(computeColorDifference(x, y, rightx, righty, base) <= COLOR_TOLERANCE && 
           computeColorDifference(x, y, leftx, lefty, base) <= COLOR_TOLERANCE) {
            rightx = rightx + 1;
            righty = righty + 1;
            leftx = leftx - 1;
            lefty = lefty - 1;
            span++;
        } else {
            break;
        }
    }

    return span;
}

function findMaxPoint(map) {
    let result = {x: -1, y: -1, score: 0};

    for(let i = 0; i < map.length; i++) {
        for(let j = 0; j < map[0].length; j++) {
            if(map[i][j] > result.score) {
                result = {x:i, y:j, score:map[i][j]};
            }
        }
    }

    return result;
}

// returns { region_num: int, x:int, y:int, brightness:int }
// input:
//   list of 2d arrays of pixels from 0-COLOR_LEVELS
function findXButton(baseMaps) {
    var result = {n: -1, x: -1, y: -1, score: -1};

    for(let i = 0; i < baseMaps.length; i++) {
        var baseMap = baseMaps[i];

        var positiveSlopeMap = computePositiveSlopeMap(baseMap);
        var negativeSlopeMap = computeNegativeSlopeMap(baseMap);
        var slopeMaxMap = computeMaxSlopeMap(baseMap, positiveSlopeMap, negativeSlopeMap);
        var diffMap = generateDiffMap(baseMap);
        var finalMap = intersectMaps(slopeMaxMap, diffMap);
        var max = findMaxPoint(finalMap);

        if(max.score > result.score) {
            result = {n: i, x: max.x, y: max.y, score: max.score};
        }
    }

    return result;
}

// generate a base map for a part of the screen
// base map is the original converted to black/white and "rounded" to a value between 0 and COLOR_LEVELS
function getBaseMapForRegion(region) {
    var baseMap = initializeArray(region.width, region.height);
    var getColorsInput = new Array(region.height * region.width);

    for(let i = 0; i < region.width; i++) {
        for(let j = 0; j < region.height; j++) {
            getColorsInput[i * region.height + j] = {x: region.x + i, y: region.y + j};    
        }
    }

    const [result, error] = getColors(getColorsInput);
    
    for(let i = 0; i < region.width; i++) {
        for(let j = 0; j < region.height; j++) {
            var rgb = intToRgb(result[i * region.width + j]);
            const maxVal = 255*3;
            baseMap[i][j] = Math.round((rgb["red"] + rgb["green"] + rgb["blue"])*COLOR_LEVELS / (maxVal));
        }
    }

    return baseMap;
}

module.exports = {
    getBaseMapForRegion, findXButton
}