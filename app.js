const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración para SQL Server Express
const dbConfig = {
    server: 'localhost\\SQLEXPRESS',
    database: 'Tarea2',
    user: 'TareaBases2',
    password: 'TareaBases2',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

let pool;
let dbConnected = true;

async function connectDB() {
    try {
        console.log('🔌 Conectando a SQL Server Express...');
        pool = await sql.connect(dbConfig);
        
        const testResult = await pool.request().query(`
            SELECT 
                @@SERVERNAME as server_name,
                DB_NAME() as database_name, 
                SUSER_NAME() as login_name
        `);
        
        console.log('✅ CONEXIÓN EXITOSA a SQL Server:');
        console.log('   Servidor:', testResult.recordset[0].server_name);
        console.log('   Base de datos:', testResult.recordset[0].database_name);
        console.log('   Login:', testResult.recordset[0].login_name);
        
    } catch (err) {
        console.error('❌ ERROR de conexión:', err.message);
        dbConnected = false;
    }
}

connectDB();

// Ruta de diagnóstico
app.get('/api/health', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.status(503).json({ 
                status: 'ERROR',
                message: '❌ Base de datos no disponible',
                timestamp: new Date().toISOString()
            });
        }

        const counts = await pool.request().query(`
            SELECT 'Empleado' as tabla, COUNT(*) as cantidad FROM Empleado WHERE EsActivo = 1
            UNION ALL
            SELECT 'Puesto', COUNT(*) FROM Puesto
            UNION ALL
            SELECT 'Usuario', COUNT(*) FROM Usuario
        `);

        res.json({ 
            status: 'OK',
            message: '✅ Conectado a SQL Server Express',
            data_counts: counts.recordset,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR',
            message: '❌ Error en diagnóstico: ' + error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Listar empleados
app.get('/api/empleados', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.status(503).json({ 
                error: 'Base de datos no disponible'
            });
        }

        console.log('📋 Obteniendo empleados...');
        
        const result = await pool.request().query(`
            SELECT 
                e.Id,
                e.Nombre,
                e.ValorDocumentoIdentidad,
                p.Nombre AS PuestoNombre,
                e.SaldoVacaciones,
                e.EsActivo
            FROM Empleado e
            INNER JOIN Puesto p ON e.IdPuesto = p.Id
            WHERE e.EsActivo = 1
            ORDER BY e.Nombre
        `);
        
        console.log(`✅ ${result.recordset.length} empleados encontrados`);
        res.json(result.recordset);
        
    } catch (error) {
        console.error('❌ Error en /api/empleados:', error.message);
        res.status(500).json({ 
            error: 'Error del servidor: ' + error.message
        });
    }
});

// Insertar empleado
app.post('/api/empleados', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.status(503).json({ 
                success: false, 
                message: 'Base de datos no disponible' 
            });
        }

        const { idPuesto, valorDocumentoIdentidad, nombre, fechaContratacion } = req.body;
        
        console.log("📝 Insertando empleado:", { idPuesto, valorDocumentoIdentidad, nombre, fechaContratacion });

        // Validaciones
        if (!idPuesto || !valorDocumentoIdentidad || !nombre || !fechaContratacion) {
            return res.status(400).json({ 
                success: false, 
                message: 'Todos los campos son requeridos' 
            });
        }

        // Obtener el próximo ID
        const maxIdResult = await pool.request().query('SELECT ISNULL(MAX(Id), 0) + 1 as nextId FROM Empleado');
        const nextId = maxIdResult.recordset[0].nextId;

        // Insertar con SaldoVacaciones = 0
        await pool.request()
            .input('id', sql.Int, nextId)
            .input('idPuesto', sql.Int, parseInt(idPuesto))
            .input('valorDocumentoIdentidad', sql.VarChar(32), valorDocumentoIdentidad)
            .input('nombre', sql.VarChar(128), nombre)
            .input('fechaContratacion', sql.Date, fechaContratacion)
            .query(`
                INSERT INTO Empleado (Id, IdPuesto, ValorDocumentoIdentidad, Nombre, FechaContratacion, SaldoVacaciones, EsActivo)
                VALUES (@id, @idPuesto, @valorDocumentoIdentidad, @nombre, @fechaContratacion, 0, 1)
            `);

        res.json({ 
            success: true, 
            message: 'Empleado insertado correctamente' 
        });
        
    } catch (error) {
        console.error('❌ Error insertando empleado:', error.message);
        
        if (error.message.includes('duplicate')) {
            res.status(400).json({ 
                success: false, 
                message: 'El documento o nombre ya existe' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Error del servidor: ' + error.message
            });
        }
    }
});

// Actualizar empleado
app.put('/api/empleados/:id', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.status(503).json({ 
                success: false, 
                message: 'Base de datos no disponible' 
            });
        }

        const { id } = req.params;
        const { idPuesto, valorDocumentoIdentidad, nombre } = req.body;
        
        console.log("📝 Actualizando empleado:", { id, idPuesto, valorDocumentoIdentidad, nombre });

        // Validaciones
        if (!idPuesto || !valorDocumentoIdentidad || !nombre) {
            return res.status(400).json({ 
                success: false, 
                message: 'Todos los campos son requeridos' 
            });
        }

        // Actualizar en la base de datos
        await pool.request()
            .input('id', sql.Int, parseInt(id))
            .input('idPuesto', sql.Int, parseInt(idPuesto))
            .input('valorDocumentoIdentidad', sql.VarChar(32), valorDocumentoIdentidad)
            .input('nombre', sql.VarChar(128), nombre)
            .query(`
                UPDATE Empleado 
                SET IdPuesto = @idPuesto, 
                    ValorDocumentoIdentidad = @valorDocumentoIdentidad, 
                    Nombre = @nombre
                WHERE Id = @id AND EsActivo = 1
            `);

        // Verificar si se actualizó algún registro
        const result = await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query('SELECT @@ROWCOUNT as affectedRows');

        if (result.recordset[0].affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Empleado no encontrado' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Empleado actualizado correctamente' 
        });
        
    } catch (error) {
        console.error('❌ Error actualizando empleado:', error.message);
        
        if (error.message.includes('duplicate')) {
            res.status(400).json({ 
                success: false, 
                message: 'El documento o nombre ya existe' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Error del servidor: ' + error.message
            });
        }
    }
});

// Eliminar empleado
app.delete('/api/empleados/:id', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.status(503).json({ 
                success: false, 
                message: 'Base de datos no disponible' 
            });
        }

        const { id } = req.params;
        
        console.log("🗑️ Eliminando empleado:", id);

        // Borrado lógico (cambiar EsActivo a 0)
        await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query(`
                UPDATE Empleado 
                SET EsActivo = 0 
                WHERE Id = @id AND EsActivo = 1
            `);

        // Verificar si se actualizó algún registro
        const result = await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query('SELECT @@ROWCOUNT as affectedRows');

        if (result.recordset[0].affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Empleado no encontrado' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Empleado eliminado correctamente' 
        });
        
    } catch (error) {
        console.error('❌ Error eliminando empleado:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Error del servidor: ' + error.message
        });
    }
});

// Movimientos
app.get('/api/movimientos/empleado/:id', async (req, res) => {
    try {
        if (!dbConnected) {
            return res.json([]);
        }

        console.log(`📋 Movimientos para empleado ${req.params.id}`);
        res.json([]);
        
    } catch (error) {
        console.error('Error en movimientos:', error.message);
        res.json([]);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor funcionando en http://localhost:${PORT}`);
    console.log(`📊 Estado BD: ${dbConnected ? '✅ CONECTADA' : '❌ DESCONECTADA'}`);
    console.log(`🔍 Diagnóstico: http://localhost:${PORT}/api/health`);
    console.log(`👥 Empleados: http://localhost:${PORT}/api/empleados`);
});