// Public interface of the Products feature. Code outside `features/products/` imports only this file.

export { PRODUCT_SIZES_G, formatSize, isDeleted as isProductDeleted, productFromFields, sortProducts, type Product, type ProductSize } from './model';
export { sheetProductsRepository, type ProductsRepository } from './repo';
export { showProductsPage, type ProductsPageDeps } from './page';
