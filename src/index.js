const express = require('express');
const morgan = require('morgan');
const path = require('path');
const app = express();
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');

const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-'); // Chuyển khoảng trắng và ký tự đặc biệt thành gạch ngang
};
const validateProduct = (req, res, next) => {
  const { name, description, price, quantity, category_id } = req.body;
  if (!name || !description || !price || !quantity || !category_id) {
    return res.status(400).send('Vui lòng điền đầy đủ thông tin sản phẩm!');
  }
  next();
};


// Cấu hình nơi lưu trữ ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'src/public/uploads'); // Đường dẫn lưu ảnh
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname); // Tên file duy nhất
  },
});
const upload = multer({ storage });
app.use(session({
  secret: '4fdcb17e38e91e9bf04828889404c059a58ab075e73a29c76236debca30bbbb354b5b7a166652ef2f7097d58ee73d22ce1b41eb8aa498dc9c5f19d1e423304ff',// node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
}));

const db = mysql.createConnection({
  host: 'localhost',
  user: 'nodejs_user',
  password: '123456',
  database: 'shop',
});
db.connect((err) => {
  if (err) {
    console.error('Lỗi kết nối MySQL:', err);
    process.exit(1);
  }
  console.log('Kết nối thành công với MySQL!');
});

// Middleware để parse body từ form hoặc JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Handlebars
const { engine } = require('express-handlebars');
app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    helpers: {
      isActive: (current, page) => (current === page ? 'active' : ''), // Đánh dấu trang hiện tại
      times: (n, block) => {
        // Lặp lại n lần
        let accum = '';
        for (let i = 0; i < n; ++i) {
          accum += block.fn(i);
        }
        return accum;
      },
      eq: (a, b) => a === b, // Helper so sánh
    },
  })
);


app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'resources/views'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Cấu hình thư mục static cho các file tĩnh
app.use(express.static(path.join(__dirname, 'public')));

// Middleware để truyền thông tin người dùng vào tất cả các view
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
  } else {
    res.locals.user = null;
  }
  next();
});

app.get('/', async (req, res) => {
  try {
    const featuredQuery = `
      SELECT id, slug, name, image, price, brand 
      FROM products 
      WHERE featured = 1 
      LIMIT 8
    `;

    const newArrivalsQuery = `
      SELECT id, slug, name, image, price, brand 
      FROM products 
      ORDER BY created_at DESC 
      LIMIT 8
    `;

    // Sử dụng `await` trong các truy vấn
    const [featuredProducts] = await db.promise().query(featuredQuery);
    const [newArrivals] = await db.promise().query(newArrivalsQuery);

    // Render trang index
    res.render('index', {
      title: 'Home',
      featuredProducts,
      newArrivals,
    });
  } catch (error) {
    console.error('Lỗi khi lấy sản phẩm:', error);
    res.status(500).send('Có lỗi xảy ra.');
  }
});
app.get('/index', async (req, res) => {
  try {
    const featuredQuery = `
      SELECT id, slug, name, image, price, brand 
      FROM products 
      WHERE featured = 1 
      LIMIT 8
    `;

    const newArrivalsQuery = `
      SELECT id, slug, name, image, price, brand 
      FROM products 
      ORDER BY created_at DESC 
      LIMIT 8
    `;

    // Sử dụng `await` trong các truy vấn
    const [featuredProducts] = await db.promise().query(featuredQuery);
    const [newArrivals] = await db.promise().query(newArrivalsQuery);

    // Render trang index
    res.render('index', {
      title: 'Home',
      featuredProducts,
      newArrivals,
    });
  } catch (error) {
    console.error('Lỗi khi lấy sản phẩm:', error);
    res.status(500).send('Có lỗi xảy ra.');
  }
});
app.get('/about', (req, res) => {
  res.render('about', { title: 'About Us' });
});
app.get('/blog', (req, res) => {
  res.render('blog', { title: 'Blog' });
});
app.get('/cart', (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) {
    return res.render('cart', { cartItems: [], cartTotal: 0 });
  }

  const ids = req.session.cart.map(item => item.id).join(',');
  const sql = `SELECT * FROM products WHERE id IN (${ids})`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Lỗi khi lấy giỏ hàng:', err);
      return res.status(500).send('Có lỗi xảy ra.');
    }

    const cartItems = req.session.cart.map(item => {
      const product = results.find(product => product.id === item.id);
      return {
        ...product,
        size: item.size,
        quantity: item.quantity,
        subtotal: product.price * item.quantity,
      };
    });

    const cartTotal = cartItems.reduce((total, item) => total + item.subtotal, 0);

    res.render('cart', { cartItems, cartTotal });
  });
});
app.post('/cart/add/:slug', (req, res) => {
  const productSlug = req.params.slug;
  const { size, quantity } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!size || !quantity || isNaN(quantity) || quantity < 1) {
    return res.status(400).send('Invalid size or quantity');
  }

  // Khởi tạo giỏ hàng nếu chưa có
  if (!req.session.cart) {
    req.session.cart = [];
  }

  // Lấy thông tin sản phẩm từ database dựa trên slug
  const productQuery = 'SELECT * FROM products WHERE slug = ?';
  db.query(productQuery, [productSlug], (err, results) => {
    if (err || results.length === 0) {
      console.error('Lỗi khi lấy sản phẩm:', err);
      return res.status(404).send('Sản phẩm không tồn tại.');
    }

    const product = results[0];

    // Kiểm tra xem sản phẩm đã có trong giỏ hàng với size tương ứng chưa
    const existingProduct = req.session.cart.find(
      item => item.id === product.id && item.size === size
    );

    if (existingProduct) {
      // Nếu đã tồn tại, tăng số lượng
      existingProduct.quantity += parseInt(quantity, 10);
    } else {
      // Nếu chưa, thêm mới
      req.session.cart.push({
        id: product.id,
        slug: product.slug,
        name: product.name,
        size,
        quantity: parseInt(quantity, 10),
        price: product.price,
      });
    }
    console.log('Cart:', req.session.cart);
    res.redirect('/cart');
  });
});
app.get('/cart/add/:slug', (req, res) => {
  const productSlug = req.params.slug;

  if (!req.session.cart) {
    req.session.cart = [];
  }

  // Lấy thông tin sản phẩm từ database
  const productQuery = 'SELECT * FROM products WHERE slug = ?';
  db.query(productQuery, [productSlug], (err, results) => {
    if (err || results.length === 0) {
      console.error('Lỗi khi lấy sản phẩm:', err);
      return res.status(404).send('Sản phẩm không tồn tại.');
    }

    const product = results[0];

    // Kiểm tra sản phẩm đã có trong giỏ hàng chưa
    const existingProduct = req.session.cart.find(item => item.id === product.id);

    if (existingProduct) {
      existingProduct.quantity += 1; // Tăng số lượng nếu sản phẩm đã tồn tại
    } else {
      req.session.cart.push({
        id: product.id,
        slug: product.slug,
        name: product.name,
        quantity: 1,
        price: product.price,
      });
    }

    res.redirect('/cart'); // Chuyển hướng về trang giỏ hàng
  });
});
app.get('/cart/remove/:slug', (req, res) => {
  const productSlug = req.params.slug; // Lấy slug sản phẩm từ URL
  const size = req.query.size; // Lấy kích thước từ query string

  // Kiểm tra giỏ hàng trong session
  if (!req.session.cart) {
    return res.redirect('/cart'); // Nếu giỏ hàng trống, quay lại trang giỏ hàng
  }

  // Lọc giỏ hàng để loại bỏ sản phẩm có slug và size tương ứng
  req.session.cart = req.session.cart.filter(item => {
    return item.slug !== productSlug || item.size !== size;
  });

  res.redirect('/cart'); // Quay lại trang giỏ hàng sau khi xóa
});
app.post('/cart/update', (req, res) => {
  const { id, size, quantity } = req.body;

  if (!req.session.cart) {
      return res.status(400).send('Cart is empty.');
  }

  // Tìm sản phẩm cần cập nhật
  const product = req.session.cart.find(item => item.id === parseInt(id) && item.size === size);
  if (!product) {
      return res.status(404).send('Product not found in cart.');
  }

  // Cập nhật số lượng
  product.quantity = parseInt(quantity);
  res.status(200).send('Quantity updated.');
});
app.post('/cart/apply-coupon', (req, res) => {
  const { coupon } = req.body;

  // Kiểm tra mã giảm giá hợp lệ (giả sử giảm 10%)
  if (coupon === 'DISCOUNT10') {
      req.session.cartTotal *= 0.9; // Giảm giá 10%
      res.json({ success: true });
  } else {
      res.json({ success: false, message: 'Invalid coupon code.' });
  }
});
app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login'); // Nếu chưa đăng nhập, chuyển hướng đến login
  }
  res.render('profile', {
    title: 'User Profile',
    user: req.session.user,
  });
});
app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact Us' });
});
app.get('/register', (req, res) => {
  res.render('register', { title: 'User Profile' });
});

app.get('/sproduct/:slug', (req, res) => {
  const productSlug = req.params.slug;

  // Query để lấy chi tiết sản phẩm bằng slug
  const productQuery = 'SELECT * FROM products WHERE slug = ?';
  db.query(productQuery, [productSlug], (err, result) => {
    if (err || result.length === 0) {
      console.error('Lỗi khi lấy sản phẩm:', err);
      return res.status(404).send('Sản phẩm không tồn tại.');
    }

    const product = {
      id: result[0].id,
      slug: result[0].slug,
      name: result[0].name,
      mainImage: result[0].image,
      images: JSON.parse(result[0].images || '[]'), // Xử lý JSON danh sách ảnh
      description: result[0].description,
      price: result[0].price,
      category: result[0].category,
      sizes: ['S', 'M', 'L', 'XL', 'XXL'], // Danh sách kích thước (cố định hoặc từ database)
    };

    // Query để lấy các sản phẩm mới
    const newArrivalsQuery = 'SELECT * FROM products ORDER BY created_at DESC LIMIT 4';
    db.query(newArrivalsQuery, (err, newArrivals) => {
      if (err) {
        console.error('Lỗi khi lấy sản phẩm mới:', err);
        return res.status(500).send('Có lỗi xảy ra.');
      }

      res.render('sproduct', {
        product,
        newArrivals: newArrivals.map(item => ({
          id: item.id,
          slug: item.slug, // Sử dụng slug cho liên kết
          name: item.name,
          image: item.image,
          brand: item.brand,
          price: item.price,
          rating: item.rating,
        })),
      });
    });
  });
});

app.post('/add-product', (req, res) => {
  const { name, description, price, quantity, category_id } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!name || !description || !price || !quantity || !category_id) {
      return res.status(400).send('Vui lòng điền đầy đủ thông tin!');
  }

  // Thêm sản phẩm vào database
  const sql = 'INSERT INTO products (name, description, price, quantity, category_id) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [name, description, price, quantity, category_id], (err, result) => {
      if (err) {
          console.error('Lỗi khi thêm sản phẩm:', err);
          return res.status(500).send('Có lỗi xảy ra. Vui lòng thử lại sau!');
      }

      console.log('Thêm sản phẩm thành công:', result);
      res.redirect('/shop'); // Điều hướng về trang shop
  });
});
app.get('/add-product', (req, res) => {
  res.render('add-product', { title: 'Add Product' });
});
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!username || !email || !password) {
    return res.status(400).render('register', {
      title: 'Register',
      error: 'Vui lòng điền đầy đủ thông tin!',
    });
  }

  try {
    // Kiểm tra xem email đã tồn tại chưa
    const checkEmailQuery = 'SELECT * FROM users WHERE email = ?';
    db.query(checkEmailQuery, [email], async (err, results) => {
      if (err) {
        console.error('Lỗi khi kiểm tra email:', err);
        return res.status(500).render('register', {
          title: 'Register',
          error: 'Có lỗi xảy ra, vui lòng thử lại sau!',
        });
      }

      if (results.length > 0) {
        return res.status(400).render('register', {
          title: 'Register',
          error: 'Email đã tồn tại!',
        });
      }

      // Mã hóa mật khẩu
      const hashedPassword = await bcrypt.hash(password, 10);

      // Thêm user vào database
      const insertUserQuery = 'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)';
      db.query(insertUserQuery, [username, email, hashedPassword, 'user'], (err, result) => {
        if (err) {
          console.error('Lỗi khi thêm user:', err);
          return res.status(500).render('register', {
            title: 'Register',
            error: 'Có lỗi xảy ra, vui lòng thử lại sau!',
          });
        }

        console.log('Đăng ký thành công:', result);
        res.render('register', {
          title: 'Register',
          success: 'Đăng ký thành công! Bạn có thể đăng nhập ngay bây giờ.',
        });
      });
    });
  } catch (err) {
    console.error('Lỗi khi xử lý đăng ký:', err);
    res.status(500).render('register', {
      title: 'Register',
      error: 'Có lỗi xảy ra, vui lòng thử lại sau!',
    });
  }
});
app.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Lỗi khi đăng xuất:', err);
      return res.status(500).send('Có lỗi xảy ra khi đăng xuất!');
    }
    res.redirect('/'); // Quay về trang chủ sau khi đăng xuất
  });
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login'); // Chuyển hướng đến trang login nếu chưa đăng nhập
  }
  next();
}
app.get('/dashboard', requireLogin, (req, res) => {
  res.render('dashboard', { title: 'Dashboard', user: req.session.user });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!email || !password) {
    return res.status(400).render('login', {
      title: 'Login',
      error: 'Vui lòng điền đầy đủ thông tin!',
    });
  }

  // Tìm user trong database
  const sql = 'SELECT * FROM users WHERE email = ?';
  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.error('Lỗi khi truy vấn database:', err);
      return res.status(500).render('login', {
        title: 'Login',
        error: 'Có lỗi xảy ra, vui lòng thử lại sau!',
      });
    }

    if (results.length === 0) {
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Email hoặc mật khẩu không chính xác!',
      });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).render('login', {
        title: 'Login',
        error: 'Email hoặc mật khẩu không chính xác!',
      });
    }

    // Lưu thông tin user vào session
    req.session.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    console.log('Đăng nhập thành công:', req.session.user);
    res.redirect('/'); // Redirect đến trang chủ hoặc dashboard
  });
});
app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});
// Middleware kiểm tra quyền admin
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('Bạn không có quyền truy cập vào trang này!');
  }
  next();
}
// -----Admin Routes-----

app.get('/admin/products', requireAdmin, (req, res) => {
  const sql = 'SELECT * FROM products';
  db.query(sql, (err, products) => {
    if (err) {
      console.error('Lỗi khi lấy danh sách sản phẩm:', err);
      return res.status(500).send('Lỗi khi lấy danh sách sản phẩm!');
    }
    res.render('admin-product', { title: 'Quản lý sản phẩm', layout: 'main', products });
  });
});

// Trang admin dashboard
app.get('/admin', requireAdmin, (req, res) => {
  res.render('admin', { title: 'Admin Dashboard', user: req.session.user });
});

// Thêm sản phẩm mới
app.get('/admin/add', requireAdmin, (req, res) => {
  res.render('admin-addproduct', { 
    title: 'Add Product', 
    layout: 'main' 
  });
});

app.post('/admin/add', upload.single('image'), validateProduct, async (req, res) => {
  try {
    const { name, description, price, quantity, category_id } = req.body;

    // Kiểm tra dữ liệu đầu vào
    if (!name || !description || !price || !quantity || !category_id) {
      return res.status(400).send('Vui lòng điền đầy đủ thông tin sản phẩm!');
    }

    // Xử lý ảnh và tạo slug
    const image = req.file ? req.file.filename : null;
    const slug = slugify(name); // Tạo slug từ tên sản phẩm

    // Câu truy vấn thêm sản phẩm
    const sql = `
      INSERT INTO products (name, slug, description, price, quantity, category_id, image) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    // Thực thi câu truy vấn
    await db.promise().query(sql, [name, slug, description, price, quantity, category_id, image]);

    // Chuyển hướng sau khi thêm thành công
    res.redirect('/admin/products');
  } catch (error) {
    console.error('Lỗi hệ thống:', error);

    // Xử lý lỗi khi thêm sản phẩm
    res.status(500).send('Lỗi khi thêm sản phẩm!');
  }
});


// Cập nhật sản phẩm
app.post('/admin/products/edit/:slug', upload.single('image'), requireAdmin, async (req, res) => {
  try {
    const productSlug = req.params.slug; // Slug hiện tại của sản phẩm
    const { name, description, price, quantity, category_id } = req.body;

    // Kiểm tra thông tin đầu vào
    if (!name || !description || !price || !quantity || !category_id) {
      return res.status(400).send('Vui lòng điền đầy đủ thông tin sản phẩm!');
    }

    // Xử lý ảnh và tạo slug mới
    const image = req.file ? req.file.filename : null;
    const newSlug = slugify(name); // Tạo slug mới từ tên sản phẩm

    // Kiểm tra sản phẩm có tồn tại không
    const checkSql = 'SELECT * FROM products WHERE slug = ?';
    const [productResults] = await db.promise().query(checkSql, [productSlug]);

    if (productResults.length === 0) {
      return res.status(404).send('Không tìm thấy sản phẩm!');
    }

    // Kiểm tra xem slug mới có trùng với sản phẩm khác không
    if (newSlug !== productSlug) {
      const slugCheckSql = 'SELECT * FROM products WHERE slug = ?';
      const [slugCheckResults] = await db.promise().query(slugCheckSql, [newSlug]);
   
      if (slugCheckResults.length > 0) {
        return res.status(400).send('Slug mới đã tồn tại, vui lòng chọn tên sản phẩm khác!');
      }
   }
   

    // Câu truy vấn cập nhật sản phẩm
    const updateSql = image
      ? 'UPDATE products SET name = ?, slug = ?, description = ?, price = ?, quantity = ?, category_id = ?, image = ? WHERE slug = ?'
      : 'UPDATE products SET name = ?, slug = ?, description = ?, price = ?, quantity = ?, category_id = ? WHERE slug = ?';

    const updateParams = image
      ? [name, newSlug, description, price, quantity, category_id, image, productSlug]
      : [name, newSlug, description, price, quantity, category_id, productSlug];

    // Thực thi câu truy vấn
    await db.promise().query(updateSql, updateParams);

    // Chuyển hướng sau khi cập nhật thành công
    res.redirect('/admin/products');
  } catch (error) {
    console.error('Lỗi hệ thống:', error);

    // Trả về thông báo lỗi chung nếu có lỗi không xác định
    res.status(500).send('Có lỗi xảy ra trong quá trình xử lý.');
  }
});




app.get('/admin/products/edit/:slug', requireAdmin, (req, res) => {
  const productSlug = req.params.slug;

  const sql = 'SELECT * FROM products WHERE slug = ?';
  db.query(sql, [productSlug], (err, result) => {
    if (err) {
      console.error('Lỗi khi lấy thông tin sản phẩm:', err);
      return res.status(500).send('Lỗi khi lấy thông tin sản phẩm!');
    }

    if (result.length === 0) {
      return res.status(404).send('Không tìm thấy sản phẩm!');
    }

    const product = result[0];
    res.render('admin-editproduct', { 
      title: 'Edit Product', 
      product, 
      layout: 'main' 
    });
  });
});

// Xóa sản phẩm
app.get('/admin/products/delete/:slug', requireAdmin, (req, res) => {
  const sql = 'DELETE FROM products WHERE slug = ?';
  db.query(sql, [req.params.slug], (err, result) => {
    if (err) {
      console.error('Lỗi khi xóa sản phẩm:', err);
      return res.status(500).send('Lỗi khi xóa sản phẩm!');
    }
    res.redirect('/admin/products');
  });
});

// Hiển thị danh sách sản phẩm với phân trang
app.get('/shop', (req, res) => {
  const itemsPerPage = 8; // Số sản phẩm mỗi trang
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * itemsPerPage;

  // Truy vấn tổng số sản phẩm
  const countQuery = 'SELECT COUNT(*) AS total FROM products';
  db.query(countQuery, (err, countResult) => {
    if (err) {
      console.error('Lỗi khi đếm sản phẩm:', err);
      return res.status(500).send('Lỗi khi đếm sản phẩm!');
    }

    const totalItems = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Truy vấn danh sách sản phẩm
    const productQuery = `
      SELECT id, slug, name, image, price 
      FROM products 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;
    db.query(productQuery, [itemsPerPage, offset], (err, products) => {
      if (err) {
        console.error('Lỗi khi lấy danh sách sản phẩm:', err);
        return res.status(500).send('Lỗi khi lấy danh sách sản phẩm!');
      }

      const pagination = {
        current: page,
        pages: Array.from({ length: totalPages }, (_, i) => i + 1),
        prev: page > 1 ? page - 1 : null,
        next: page < totalPages ? page + 1 : null,
      };

      res.render('shop', { 
        title: 'Shop', 
        products, 
        pagination 
      });
    });
  });
});


// Trang quản lý sản phẩm

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong!' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


