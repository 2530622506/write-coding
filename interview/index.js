var maxArea = function (height) {
  let left = 0,
    right = height.length - 1,
    maxWater = 0

  while (left < right) {
    let curHeight = Math.min(height[left], height[right])
    let curWidth = right - left
    let curArea = curWidth * curHeight
    maxWater = Math.max(maxWater, curArea)

    if (height[left] < height[right]) {
      left++
    } else {
      right--
    }
  }
  return maxWater
}
