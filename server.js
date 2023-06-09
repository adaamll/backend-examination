const express = require('express');
const Datastore = require('nedb');
const { v4: uuidv4 } = require('uuid');
const { isAdmin } = require('./middleware');

const app = express();
app.use(express.json());

const accountsDB = new Datastore({ filename: 'accounts.db', autoload: true });

const menuDB = new Datastore({ filename: 'menu.db', autoload: true });

const ordersDB = new Datastore({ filename: 'orders.db', autoload: true });

const offersDB = new Datastore({ filename: 'offers.db', autoload: true });

function initiateDatabase() {
  accountsDB.ensureIndex({ fieldName: 'username', unique: true });
}

// GET-anrop till menyn
app.get('/api/coffee', (_request, response) => {
  menuDB.find({}, (error, menu) => {
    if (error) {
      return response.status(500).json('Internal server error');
    }
    return response.json(menu);
  });
});

// POST-anrop till databasen för konton
app.post('/api/account', (request, response) => {
  const { username, password, email, role } = request.body;
  console.log('Konto att lägga till:', username, password, email, role);

  if (!username || !password || !email || !role) {
    return response.status(400).json('Bad request');
  }

  const account = { username, password, email, role };

  accountsDB.insert(account, error => {
    if (error) {
      if (error.errorType === 'uniqueViolated') {
        return response.status(409).json('Email or username already exists');
      }
      return response.status(500).json('Internal server error');
    }
    return response.status(201).json('Registered account successfully');
  });
});

// POST: Lägg order
app.post('/api/order', (request, response) => {
  const { username, items } = request.body;
  console.log('Order att lägga:', username, items);

  if (!username || !items || !items.length) {
    return response.status(400).json('Bad request');
  }

  accountsDB.findOne({ username }, (error, account) => {
    if (error || !account) {
      return response.status(401).json('Unauthorized');
    }

    const orderItems = [];
    let orderTotal = 0;

    const fetchMenuItem = (itemId, callback) => {
      menuDB.findOne({ id: itemId }, (error, item) => {
        if (error || !item) {
          callback(`Item with ID ${itemId} not found in menu`);
        } else {
          callback(null, item);
        }
      });
    };

    const applyOfferDiscount = (items, callback) => {
      const productIds = items.map(item => item.id);

      // Hitta kampanjer som matchar produkterna i beställningen
      offersDB.findOne({ products: { $all: productIds } }, (error, offer) => {
        if (error || !offer) {
          // Ingen kampanj hittades, fortsätt utan rabatt
          callback(null, items);
        } else {
          const campaignPrice = offer.price;

          const discountedItems = items.map(item => {
            if (productIds.includes(item.id)) {
              // Justera priset och den totala kostnaden för varje produkt baserat på kampanjpriset
              const discountPrice = campaignPrice / item.quantity;
              return {
                ...item,
                price: discountPrice,
                total: discountPrice * item.quantity,
              };
            }
            return item;
          });

          callback(null, discountedItems);
        }
      });
    };

    const processItem = (item, quantity, callback) => {
      const total = item.price * quantity;
      orderTotal += total;
      orderItems.push({ ...item, quantity, total });
      callback();
    };

    let itemsProcessed = 0;
    const itemsCount = items.length;

    items.forEach(item => {
      const itemId = item.id;
      const itemQuantity = item.quantity;

      fetchMenuItem(itemId, (error, menuItem) => {
        if (error) {
          return response.status(400).json(error);
        }

        processItem(menuItem, itemQuantity, () => {
          itemsProcessed++;
          if (itemsProcessed === itemsCount) {
            applyOfferDiscount(orderItems, (error, discountedItems) => {
              if (error) {
                return response.status(500).json('Internal server error');
              }

              const eta = new Date();
              eta.setMinutes(eta.getMinutes() + 15);
              const orderId = uuidv4();
              const order = {
                username,
                items: discountedItems,
                total: orderTotal,
                eta,
                id: orderId,
              };
              ordersDB.insert(order, error => {
                if (error) {
                  return response.status(500).json('Internal server error');
                }
                return response.status(201).json({ eta, id: orderId });
              });
            });
          }
        });
      });
    });
  });
});

// GET-anrop till orders
app.get('/api/order/:username', (request, response) => {
  const { username } = request.params;

  if (!username) {
    return response.status(400).json('Bad request');
  }

  accountsDB.findOne({ username }, (error, account) => {
    if (error || !account) {
      return response.status(404).json('Not found');
    }

    ordersDB.find({ username }, (error, orders) => {
      if (error) {
        return response.status(500).json('Internal server error');
      }
      return response.json(orders);
    });
  });
});

// POST anrop för att lägga till en ny produkt i menyn
app.post('/api/menu', isAdmin, (request, response) => {
  const { id, title, desc, price } = request.body;

  if (!id || !title || !desc || !price) {
    return response.status(400).json('Bad request');
  }

  const menuItem = { id, title, desc, price };

  menuDB.insert(menuItem, (error, newDoc) => {
    if (error) {
      console.error('Error adding menu item:', error);
      return response.status(500).json('Internal server error');
    }

    return response.status(201).json(newDoc);
  });
});

app.put('/api/menu/:id', isAdmin, (request, response) => {
  const { id } = request.params;
  const { title, desc, price } = request.body;

  if (!id || !title || !desc || !price) {
    return response.status(400).json('Bad request');
  }

  const updatedProduct = {
    title,
    desc,
    price,
    modifiedAt: new Date().toISOString(),
  };

  menuDB.update(
    { id: Number(id) },
    { $set: updatedProduct },
    {},
    (error, numReplaced) => {
      if (error) {
        console.error('Error updating menu item:', error);
        return response.status(500).json('Internal server error');
      }

      if (numReplaced === 0) {
        return response.status(404).json('Product not found');
      }

      return response.json(updatedProduct);
    }
  );
});

app.delete('/api/menu/:id', isAdmin, (request, response) => {
  const { id } = request.params;

  if (!id) {
    return response.status(400).json('Bad request');
  }

  menuDB.findOne({ id: Number(id) }, (error, product) => {
    if (error || !product) {
      return response.status(404).json('Product not found');
    }

    menuDB.remove({ _id: product._id }, {}, (error, numRemoved) => {
      if (error || numRemoved === 0) {
        return response.status(500).json('Internal server error');
      }

      return response.json('Product deleted successfully');
    });
  });
});

// POST-anrop för att lägga till kampanjerbjudanden
app.post('/api/offers', (request, response) => {
  const { products, price } = request.body;

  if (!products || !price) {
    return response.status(400).json('Bad request');
  }

  // Kontrollera att alla produkter i kampanjen finns i menyn
  const productIds = products.map(productId => Number(productId));
  menuDB.find({ id: { $in: productIds } }, (error, foundProducts) => {
    if (error) {
      return response.status(500).json('Internal server error');
    }

    if (foundProducts.length !== productIds.length) {
      return response.status(400).json('Invalid products in the offer');
    }

    const offer = {
      products: foundProducts,
      price,
    };

    // Spara kampanjerbjudandet i databasen
    offersDB.insert(offer, (error, newOffer) => {
      if (error) {
        console.error('Error adding offer:', error);
        return response.status(500).json('Internal server error');
      }

      return response.status(201).json(newOffer);
    });
  });
});

// Starta servern och initiera databasen
const PORT = 8000;
app.listen(8000, () => {
  console.info(`Server started on port ${PORT}`);
  initiateDatabase();
});
