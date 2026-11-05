import { deleteProduct as deleteCatalogueProduct } from './catalogue-api.js';

// Compatibility route: keep the older product endpoint on the same guarded
// deletion policy as the current catalogue API.
export async function deleteProduct(env,id){
  return deleteCatalogueProduct(env,id);
}
