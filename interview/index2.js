var threeSum = function (nums) {
  if (nums.length < 3) return []
  let res = []

  nums.sort((a, b) => a - b)
  for (let i = 0; i < nums.length; i++) {
    let left = i + 1,
      right = nums.length - 1

    if (i > 0 && nums[i] == nums[i - 1]) continue

    while (left < right) {
      let leftSum = nums[left],
        rightSum = nums[right]
      let threeSums = nums[i] + leftSum + rightSum
      if (threeSums > 0) {
        right--
      } else if (threeSums < 0) {
        left++
      } else {
        res.push([nums[i], nums[left], nums[right]])

        while (left < right && nums[left] == nums[left + 1]) {
          left++
        }
        while (left < right && nums[right] == nums[right - 1]) {
          right--
        }
        left++
        right--
      }
    }
  }
  return res
}
