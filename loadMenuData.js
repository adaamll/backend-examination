const Datastore = require('nedb');
const menuData = require('./menu.json');

const menuDB = new Datastore({ filename: 'menu.db', autoload: true });

function initializeMenuDatabase() {
  menuDB.remove({}, { multi: true }, (error, numRemoved) => {
    if (error) {
      console.error('Error removing existing menu items:', error);
    } else {
      console.log('Removed', numRemoved, 'existing menu items');

      const menuItems = menuData.menu;

      menuDB.insert(menuItems, (error, newDocs) => {
        if (error) {
          console.error('Error inserting menu items:', error);
        } else {
          console.log('Inserted', newDocs.length, 'menu items');
        }
      });
    }
  });
}

initializeMenuDatabase();
