// The ground height of a region's elevation grid, with no three.js, so the road network (pure data,
// run under node) can read the same hills the world draws. terrain.js builds the land from this
// exact function; see its header for why the ground is planar triangles.

/** groundHeight(data.terrain) -> heightAt(x, z); 0 everywhere when the region has no grid */
export function groundHeight(T) {
  if (!T) return () => 0;
  const { x0, z0, step, nx, nz, heights } = T;
  const x1 = x0 + (nx - 1) * step, z1 = z0 + (nz - 1) * step;
  const at = (i, j) => heights[j * nx + i];
  /** ground height at a world point; 0 outside the grid, so the jet centre past it stays flat */
  return function heightAt(x, z) {
    if (x < x0 || x > x1 || z < z0 || z > z1) return 0;
    const fx = (x - x0) / step, fz = (z - z0) / step;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= nx - 1) i = nx - 2; if (i < 0) i = 0;
    if (j >= nz - 1) j = nz - 2; if (j < 0) j = 0;
    const u = fx - i, v = fz - j;
    const h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
    // planar inside whichever triangle the point falls in
    return u + v <= 1
      ? h00 + u * (h10 - h00) + v * (h01 - h00)
      : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
}
