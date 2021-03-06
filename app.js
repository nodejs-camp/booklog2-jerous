var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var http = require('http');  //啟動Server的http
var passport = require('passport'), FacebookStrategy = require('passport-facebook').Strategy ;  //passport facebook login
var session = require('express-session'); //使用session

var routes = require('./routes/index');
var users = require('./routes/users');
var posts = require('./routes/posts');  //1123 class morning add
var paypal = require('./routes/paypal');

var app = express();

//引入mongoose  並設定資料庫位置名稱
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/booklog2');

//show mongoose連接訊息
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function callback () {
  console.log('MongoDB: connected.');	
});

// 定義資料庫schema
var postSchema = new mongoose.Schema({
    //從User表中ref objectid當作新文章objectid  用來表示作者
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }, // ref的value要mongodb中的collections name
    title: String,
    content: String,
    videoid: String,
    timeCreated: {type: Date, default: Date.now, select: false },
    wchars: {type: Number, default: 0 }, //寫不寫沒差 因為是後來schema plugin才加入的  養成好習慣還是先定義起來
    
    // PayPal payments 以購買尚未付款
    orders: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
      // Execute paypal payment中的validate需要取得paymentId(以購買但尚未付款) 所以改true
      paypal: { type: Object, select: true }  
    }],
    
    //該篇內容已購買的人 寫成矩陣在addtoset時不用另外指定key
    customers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    granted: {type: Boolean, default: false }
});

var userSchema = new mongoose.Schema({
    //http://mongoosejs.com/docs/api.html#schematype_SchemaType-select
    //select只有用path的方式才有用  參考posts.js的33行  2.6版的find也可用
    //path是因為postschema中的userid是reference來的  所以可以用select來選擇populate時的欄位是否要顯示
    //select預設為true
    username: {type: String, unique: true, select: false },
    displayName: {type: String, unique: true/*, select: true*/ },
    email: {type: String, unique: true, select: false },
    timeCreated: {type: Date, default: Date.now, select: false },
    facebook: {type: Object, select: false}
});


postSchema.index( { title : 1 } ); //定義postschema中的title為index欄位
postSchema.index( { title : "text" } );  //表示title欄位可以使用全文檢索
postSchema.index( { content: "text" } );  // windows版可能沒有$text $search這個用法  只能用$req 正規表示式

//include plugin to schema
postSchema.plugin(require('./schema/countPlugin'));


//定義express中的資料庫物件好存取
app.db = {
	model: {
		Post: mongoose.model('post', postSchema),        //注意mongodb中的collection name和mongoose引用要少一個s
        User: mongoose.model('user', userSchema)
    }
};


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev')); //會紀錄下幾乎所有的資訊，包含 HTTP 請求、送出的 Static Files 等。
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser()); //用來處理 HTTP Cookies 的 Middleware。它可以協助我們解析 Cookies，並將所有的 Cookies 放在 req.cookies 物件（Key-Value Pairs 格式）
//用來指定 "Static Files" 的路徑
app.use(express.static(path.join(__dirname, 'public')));

// passport facebook login use
app.use(session({ secret: 'booklog2-jerous' }));
app.use(passport.initialize());   //會跳錯  根據/guide/configure/新增
app.use(passport.session());   //會跳錯  根據/guide/configure/新增

//Sessions (optional)
passport.serializeUser(function(user, done) {  //保存user
  done(null, user);  
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

passport.use(new FacebookStrategy({
        clientID: '558384574291566',
        clientSecret: '6ab75ab8c84558bba463699205f96df3',
        callbackURL: "http://jerous.funtube.tw/auth/facebook/callback"
    },
    function(accessToken, refreshToken, profile, done) {
        console.log(profile);
        //return done(null, profile);
        //實作寫入資料庫
        app.db.model.User.findOne({"facebook._json.id": profile._json.id}, function(err, user) {
            if (!user) {
                var obj = {
                    username: profile.username,
                    displayName: profile.displayName,
                    email: '',
                    facebook: profile
                };
    
            var doc = new app.db.model.User(obj);
            doc.save();
    
            user = doc;
            }
    
            return done(null, user); 
        });
    }
));

// 加上判斷登入後 login 改成 logout
// 新增express變數讓jade讀取(middleware)
// 參考 http://stackoverflow.com/questions/16424947/
// 因為nodejs express是單線程的概念，如果不加上next，程式就會停在這裡。不同於其他的use，可能表示route，所以不用next
app.use('/', function(req, res, next){
    res.locals.user = req.user ;
    next();
});


app.use('/', routes);   //use表示所有協定所有網頁都要做
app.use('/users', users);

//paypel api
app.use(paypal);


//另一種middleware寫法
//app.get('/1/post', function(req, res, next){
//    console.log('this is a express middleware');
//    next();
//}, posts.list);
//新增middleware  可用來判斷是否登入才讀取頁面等功能
app.get('/1/post', function(req, res, next){
    console.log('this is a express middleware');
    next();
});
//1123 class morning add (express middleware的關係  改到這裡才會work  不然會先跳404)
app.get('/1/post', posts.list);
app.get('/1/post/:tag', posts.listByTag);
app.post('/1/post', posts.create);


//FB login
app.get('/login', passport.authenticate('facebook'));
app.get('/auth/facebook/callback', 
    passport.authenticate('facebook', { 
        successRedirect: '/',
        failureRedirect: '/login/failmessage/' 
    })
);

app.get('/logout', function(req, res){
    req.logout();
    res.redirect('/');
});
  
// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

//啟動Server的http並設定port
http.createServer(app).listen(3000, function(){
    console.log('Express server lisening on port 3000');
});

module.exports = app;